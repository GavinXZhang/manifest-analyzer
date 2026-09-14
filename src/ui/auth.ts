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
<style>
  body { margin:0; min-height:100vh; display:grid; place-items:center; font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;
         background:linear-gradient(180deg,#0d1322 0%,#141c33 100%); }
  .box { background:#fff; border-radius:16px; padding:34px 38px; width:min(360px,90vw); box-shadow:0 18px 48px rgba(0,0,0,.4); }
  h1 { font-size:18px; margin:0 0 4px; color:#12161f; letter-spacing:-.01em; }
  p { margin:0 0 18px; font-size:13px; color:#8a93a3; }
  input { font:inherit; width:100%; box-sizing:border-box; padding:10px 12px; border:1px solid #d7dce6; border-radius:10px; }
  input:focus { outline:none; border-color:#4f46e5; box-shadow:0 0 0 3px rgba(79,70,229,.16); }
  button { font:inherit; font-weight:650; width:100%; margin-top:12px; padding:10px; border:0; border-radius:10px;
           background:#4f46e5; color:#fff; cursor:pointer; }
  button:hover { background:#4338ca; }
  .err { color:#c62f2f; font-size:13px; font-weight:600; margin:10px 0 0; min-height:18px; }
</style></head><body>
<form class="box" id="f">
  <h1>Manifest Analyzer</h1>
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
