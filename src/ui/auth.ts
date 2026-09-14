import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { Router, json } from 'express';
import type { NextFunction, Request, Response } from 'express';

/**
 * Single-user password gate for hosting the app beyond localhost.
 *
 * Enabled by setting MA_PASSWORD. Sessions are stateless HMAC-signed cookies
 * (no server-side session store), so auth survives restarts and works on
 * serverless hosts. The ICS calendar feed can bypass the cookie with a
 * derived `?key=` token so Google Calendar can poll it.
 */

const COOKIE = 'ma_session';
const SESSION_MS = 14 * 24 * 3600_000;

function cookieKey(password: string): Buffer {
  return createHash('sha256').update(`manifest-analyzer-cookie-v1:${password}`).digest();
}

function sign(payload: string, password: string): string {
  return createHmac('sha256', cookieKey(password)).update(payload).digest('hex');
}

export function makeToken(password: string, now = Date.now()): string {
  const exp = now + SESSION_MS;
  return `${exp}.${sign(String(exp), password)}`;
}

export function verifyToken(token: string, password: string, now = Date.now()): boolean {
  const dot = token.indexOf('.');
  if (dot < 0) return false;
  const expStr = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const exp = Number(expStr);
  if (!Number.isFinite(exp) || exp < now) return false;
  const expected = sign(expStr, password);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Read-only token that lets a calendar client poll /api/calendar.ics. */
export function feedKey(password: string): string {
  return sign('ics-feed', password).slice(0, 24);
}

function getCookie(req: Request, name: string): string | null {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq > 0 && part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return null;
}

function passwordsMatch(supplied: string, actual: string): boolean {
  const a = createHash('sha256').update(supplied).digest();
  const b = createHash('sha256').update(actual).digest();
  return timingSafeEqual(a, b);
}

const LOGIN_PAGE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Sign in — Manifest Analyzer</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600&display=swap"/>
<style>
  body { margin:0; min-height:100vh; display:grid; place-items:center; font-family:'IBM Plex Sans',system-ui,-apple-system,"Segoe UI",sans-serif;
         background:#14213a; color:#172033; }
  .box { background:#fff; border-radius:8px; padding:30px 32px; width:min(360px,90vw); border:1px solid #e3e6ea; }
  .brand { display:flex; align-items:center; gap:10px; margin-bottom:18px; font-weight:600; font-size:15px; }
  .brand span { display:grid; place-items:center; width:30px; height:30px; border-radius:6px; background:#1b6a99; }
  h1 { font-size:16px; margin:0 0 4px; letter-spacing:-.01em; }
  p { margin:0 0 16px; font-size:13px; color:#5f6b7a; }
  input { font:inherit; width:100%; box-sizing:border-box; height:40px; padding:0 12px; border:1px solid #d5d9df; border-radius:6px; }
  input:focus { outline:none; border-color:#1b6a99; box-shadow:0 0 0 3px rgba(27,106,153,.15); }
  button { font:inherit; font-weight:600; width:100%; margin-top:12px; height:40px; border:0; border-radius:6px;
           background:#1b6a99; color:#fff; cursor:pointer; }
  button:hover { background:#134d70; }
  .err { color:#b13a34; font-size:13px; font-weight:500; margin:10px 0 0; min-height:18px; }
</style></head><body>
<form class="box" id="f">
  <div class="brand"><span><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 8.5 12 3 3 8.5v7L12 21l9-5.5v-7Z"/><path d="M3 8.5 12 14l9-5.5"/><path d="M12 14v7"/></svg></span>Manifest Analyzer</div>
  <h1>Sign in</h1>
  <p>Enter your password to continue.</p>
  <input id="pw" type="password" autocomplete="current-password" autofocus placeholder="Password" />
  <button type="submit">Sign in</button>
  <div class="err" id="err"></div>
</form>
<script>
  document.getElementById('f').addEventListener('submit', async (e) => {
    e.preventDefault();
    const res = await fetch('/api/login', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ password: document.getElementById('pw').value }),
    });
    if (res.ok) location.href = '/';
    else document.getElementById('err').textContent = (await res.json()).error || 'Wrong password';
  });
</script></body></html>`;

/** Sliding-window login throttle: 10 attempts per 5 minutes per IP. */
const attempts = new Map<string, { count: number; resetAt: number }>();
function throttled(ip: string): boolean {
  const now = Date.now();
  const entry = attempts.get(ip);
  if (!entry || entry.resetAt < now) {
    attempts.set(ip, { count: 1, resetAt: now + 5 * 60_000 });
    return false;
  }
  entry.count += 1;
  return entry.count > 10;
}

export function createAuth(password: string): {
  router: Router;
  middleware: (req: Request, res: Response, next: NextFunction) => void;
} {
  const router = Router();
  router.use(json());

  router.get('/login', (_req, res) => {
    res.type('html').send(LOGIN_PAGE);
  });

  router.post('/api/login', (req, res) => {
    if (throttled(req.ip ?? 'unknown')) {
      return res.status(429).json({ error: 'Too many attempts — wait five minutes' });
    }
    const supplied = (req.body as { password?: string }).password ?? '';
    if (!passwordsMatch(supplied, password)) {
      return res.status(401).json({ error: 'Wrong password' });
    }
    const secure = req.secure || req.headers['x-forwarded-proto'] === 'https';
    res.setHeader(
      'Set-Cookie',
      `${COOKIE}=${makeToken(password)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_MS / 1000}${secure ? '; Secure' : ''}`,
    );
    res.json({ ok: true });
  });

  router.post('/api/logout', (_req, res) => {
    res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
    res.json({ ok: true });
  });

  const middleware = (req: Request, res: Response, next: NextFunction): void => {
    if (req.path === '/login' || req.path === '/api/login') return next();
    if (req.path === '/api/calendar.ics' && req.query.key === feedKey(password)) return next();
    const token = getCookie(req, COOKIE);
    if (token && verifyToken(token, password)) return next();
    if (req.path.startsWith('/api')) {
      res.status(401).json({ error: 'Not signed in' });
    } else {
      res.redirect('/login');
    }
  };

  return { router, middleware };
}
