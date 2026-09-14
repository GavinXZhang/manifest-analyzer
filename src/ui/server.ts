import express from 'express';
import { join } from 'node:path';
import type { Db } from '../store/db.ts';
import { openDb } from '../store/db.ts';
import { createApi } from './api.ts';
import { createLifecycleApi } from './api-lifecycle.ts';
import { createAuth, feedKey } from './auth.ts';
import { existsSync } from 'node:fs';

export interface AppOptions {
  /** When set, every route is gated behind a password login. */
  password?: string | null;
  /** Where the built web app lives (defaults to ../../web/dist). */
  publicDir?: string;
  /** The previous vanilla SPA, served at /legacy until the new app reaches parity. */
  legacyDir?: string | null;
}

export function createApp(db: Db, options: AppOptions = {}): express.Express {
  const app = express();
  const password = options.password ?? null;
  if (password) {
    const auth = createAuth(password);
    app.use(auth.router);
    app.use(auth.middleware);
    // Settings → Integrations shows this so the user can paste it into Google Calendar.
    app.get('/api/feed-info', (req, res) => {
      const proto = req.headers['x-forwarded-proto'] ?? req.protocol;
      res.json({ feedUrl: `${proto}://${req.headers.host}/api/calendar.ics?key=${feedKey(password)}`, passwordEnabled: true });
    });
  } else {
    app.get('/api/feed-info', (req, res) => {
      res.json({ feedUrl: `${req.protocol}://${req.headers.host}/api/calendar.ics`, passwordEnabled: false });
    });
  }
  const legacyApi = createApi(db);
  app.use('/api', createLifecycleApi(db, { aiDraft: legacyApi.aiDraft }));
  app.use('/api', legacyApi.router);

  const legacyDir = options.legacyDir === undefined ? join(import.meta.dirname, 'public') : options.legacyDir;
  if (legacyDir && existsSync(legacyDir)) app.use('/legacy', express.static(legacyDir));

  const publicDir = options.publicDir ?? join(import.meta.dirname, '..', '..', 'web', 'dist');
  if (existsSync(publicDir)) {
    app.use(express.static(publicDir, { index: 'index.html' }));
    // SPA fallback: any non-API, non-file path renders the app shell.
    app.get(/^\/(?!api\/|legacy\/).*/, (req, res, next) => {
      if (req.method !== 'GET' || req.path.includes('.')) return next();
      res.sendFile(join(publicDir, 'index.html'));
    });
  }
  return app;
}

/**
 * Database resolution, local-first:
 *   TURSO_DATABASE_URL (+ TURSO_AUTH_TOKEN)  — hosted on Turso
 *   MA_DB_URL                                — any libsql URL
 *   MA_DB_PATH                               — legacy: a plain file path
 *   default                                  — file:./data/analyzer.db
 */
export function resolveDbConfig(): { url: string; authToken?: string } {
  if (process.env.TURSO_DATABASE_URL) {
    return { url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN };
  }
  if (process.env.MA_DB_URL) {
    return { url: process.env.MA_DB_URL, authToken: process.env.MA_DB_AUTH_TOKEN };
  }
  if (process.env.MA_DB_PATH) return { url: `file:${process.env.MA_DB_PATH}` };
  return { url: `file:${join(process.cwd(), 'data', 'analyzer.db')}` };
}

if (import.meta.main) {
  const PORT = Number(process.env.MA_PORT ?? 4317);
  const HOST = process.env.MA_HOST ?? '127.0.0.1';
  const password = process.env.MA_PASSWORD ?? null;
  const dbConfig = resolveDbConfig();
  const db = await openDb(dbConfig.url, dbConfig.authToken);
  const app = createApp(db, { password });
  // Local-first default: loopback only. Set MA_HOST=0.0.0.0 (with MA_PASSWORD!)
  // only when deliberately exposing the app. Never talks to bstock.com either way.
  app.listen(PORT, HOST, () => {
    console.log(`Manifest Analyzer running at http://${HOST}:${PORT}`);
    console.log(`Database: ${dbConfig.url}`);
    console.log(password ? 'Password login: ENABLED' : 'Password login: disabled (set MA_PASSWORD to enable)');
  });
}
