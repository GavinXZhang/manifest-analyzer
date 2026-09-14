import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from './db.ts';
import {
  addStorageUnit,
  deleteStorageUnit,
  listStorageUnits,
  addWorkEntry,
  deleteWorkEntry,
  listWorkEntries,
  totalHours,
  getTimer,
  startTimer,
  clearTimer,
} from './workspace.ts';

test('storage units: add/list/delete with validation', async () => {
  const db = await openDb(':memory:');
  const unit = await addStorageUnit(db, { name: 'CubeSmart 10x15', monthlyCost: 189, dueDay: 1, note: 'gate 4421' });
  assert.equal(unit.monthlyCost, 189);
  assert.equal((await listStorageUnits(db)).length, 1);

  await assert.rejects(addStorageUnit(db, { name: '', monthlyCost: 10, dueDay: 1 }));
  await assert.rejects(addStorageUnit(db, { name: 'x', monthlyCost: -5, dueDay: 1 }));
  await assert.rejects(addStorageUnit(db, { name: 'x', monthlyCost: 5, dueDay: 31 }), 'day 31 does not exist every month');

  await deleteStorageUnit(db, unit.id);
  assert.equal((await listStorageUnits(db)).length, 0);
});

test('work hours: add/list/delete, totals', async () => {
  const db = await openDb(':memory:');
  await addWorkEntry(db, { date: '2026-08-20', hours: 2.5, note: 'pallet pickup' });
  await addWorkEntry(db, { date: '2026-08-21', hours: 1.25, note: 'listing photos' });

  await assert.rejects(addWorkEntry(db, { date: 'nope', hours: 1 }));
  await assert.rejects(addWorkEntry(db, { date: '2026-08-20', hours: 0 }));
  await assert.rejects(addWorkEntry(db, { date: '2026-08-20', hours: 30 }));

  assert.equal(await totalHours(db), 3.75);
  const entries = await listWorkEntries(db);
  assert.equal(entries.length, 2);
  assert.equal(entries[0].date, '2026-08-21', 'newest first');

  await deleteWorkEntry(db, entries[0].id);
  assert.equal(await totalHours(db), 2.5);
});

test('timer: single instance, survives reads, clears cleanly', async () => {
  const db = await openDb(':memory:');
  assert.equal(await getTimer(db), null);

  const timer = await startTimer(db, { note: 'photographing couches', lotId: null });
  assert.equal(timer.note, 'photographing couches');
  assert.ok(timer.startedAt);

  await assert.rejects(startTimer(db), /already running/);
  assert.equal((await getTimer(db))?.note, 'photographing couches', 'still the original timer');

  await clearTimer(db);
  assert.equal(await getTimer(db), null);
  await clearTimer(db); // idempotent
});
