import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { openDb, type Db } from '../store/db.ts';
import { createApp } from './server.ts';
import { makeToken, verifyToken, feedKey } from './auth.ts';
import { addEvent } from '../store/events.ts';
import { buildIcs } from './ics.ts';

const PASSWORD = 'hunter2-but-longer';

let server: Server;
let base: string;
let db: Db;

before(async () => {
  db = await openDb(':memory:');
  const app = createApp(db, { password: PASSWORD });
  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => server.close());

test('tokens: sign/verify roundtrip, expiry, tamper resistance', () => {
  const token = makeToken(PASSWORD);
  assert.equal(verifyToken(token, PASSWORD), true);
  assert.equal(verifyToken(token, 'wrong-password'), false);
  assert.equal(verifyToken(`${token}x`, PASSWORD), false);
  assert.equal(verifyToken('garbage', PASSWORD), false);

  const expired = makeToken(PASSWORD, Date.now() - 30 * 24 * 3600_000);
  assert.equal(verifyToken(expired, PASSWORD), false);
});

test('gate: API returns 401, pages redirect to /login', async () => {
  const apiRes = await fetch(`${base}/api/lots`);
  assert.equal(apiRes.status, 401);

  const pageRes = await fetch(`${base}/`, { redirect: 'manual' });
  assert.equal(pageRes.status, 302);
  assert.equal(pageRes.headers.get('location'), '/login');

  const loginPage = await fetch(`${base}/login`);
  assert.equal(loginPage.status, 200);
  assert.match(await loginPage.text(), /Enter your password/);
});

test('login: wrong password rejected, right password issues a working cookie', async () => {
  const bad = await fetch(`${base}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: 'nope' }),
  });
  assert.equal(bad.status, 401);

  const good = await fetch(`${base}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: PASSWORD }),
  });
  assert.equal(good.status, 200);
  const cookie = good.headers.get('set-cookie');
  assert.ok(cookie?.includes('ma_session='));
  assert.ok(cookie?.includes('HttpOnly'));

  const authed = await fetch(`${base}/api/lots`, { headers: { cookie: cookie!.split(';')[0] } });
  assert.equal(authed.status, 200);

  const feedInfo = await fetch(`${base}/api/feed-info`, { headers: { cookie: cookie!.split(';')[0] } });
  const { feedUrl } = (await feedInfo.json()) as { feedUrl: string };
  assert.ok(feedUrl.includes(`key=${feedKey(PASSWORD)}`));
});

test('ics feed: key token bypasses the cookie, wrong key does not', async () => {
  await addEvent(db, { title: 'Deliver sofa, then coffee; maybe', kind: 'delivery', date: '2026-09-01', time: '14:30' });
  await addEvent(db, { title: 'Open viewing', kind: 'viewing', date: '2026-09-05' });

  const noKey = await fetch(`${base}/api/calendar.ics`);
  assert.equal(noKey.status, 401);
  const wrongKey = await fetch(`${base}/api/calendar.ics?key=badbadbad`);
  assert.equal(wrongKey.status, 401);

  const ok = await fetch(`${base}/api/calendar.ics?key=${feedKey(PASSWORD)}`);
  assert.equal(ok.status, 200);
  assert.match(ok.headers.get('content-type') ?? '', /text\/calendar/);
  const ics = await ok.text();
  assert.match(ics, /BEGIN:VCALENDAR\r\n/);
  assert.match(ics, /SUMMARY:\[delivery\] Deliver sofa\\, then coffee\\; maybe/, 'commas and semicolons escaped');
  assert.match(ics, /DTSTART:20260901T143000/);
  assert.match(ics, /DTEND:20260901T153000/, 'timed events default to one hour');
  assert.match(ics, /DTSTART;VALUE=DATE:20260905/, 'no time means all-day');
});

test('buildIcs: late-night events roll DTEND to the next day', () => {
  const ics = buildIcs([
    {
      id: 1, title: 'Night pickup', kind: 'pickup', date: '2026-09-10', time: '23:30',
      contact: null, note: null, inventoryId: null, createdAt: '2026-09-01T00:00:00Z',
    },
  ]);
  assert.match(ics, /DTSTART:20260910T233000/);
  assert.match(ics, /DTEND:20260911T003000/);
});
