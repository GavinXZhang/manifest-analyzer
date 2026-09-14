/**
 * Vercel serverless entry point (bundled to api/app.mjs by `npm run bundle:vercel`
 * before deploying — Vercel's own compiler doesn't follow .ts-extension imports,
 * so we hand it a single self-contained JS file instead).
 *
 * All routes (API + the SPA's static files) flow through the Express app so the
 * password gate covers everything.
 *
 * Required environment variables on Vercel:
 *   TURSO_DATABASE_URL  — libsql://<db-name>-<org>.turso.io
 *   TURSO_AUTH_TOKEN    — from `turso db tokens create <db-name>`
 *   MA_PASSWORD         — the login password (never deploy without it)
 */
import { join } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { openDb } from './store/db.ts';
import { createApp, resolveDbConfig } from './ui/server.ts';

const appPromise = (async () => {
  const { url, authToken } = resolveDbConfig();
  const db = await openDb(url, authToken);
  return createApp(db, {
    password: process.env.MA_PASSWORD ?? null,
    publicDir: join(process.cwd(), 'src', 'ui', 'public'),
  });
})();

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const app = await appPromise;
  app(req, res);
}
