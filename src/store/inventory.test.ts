import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from './db.ts';
import {
  addInventoryItem,
  updateInventoryItem,
  deleteInventoryItem,
  listInventory,
} from './inventory.ts';
import { addEvent, deleteEvent, listEvents } from './events.ts';

test('inventory: add, update, sold items sort last, delete', async () => {
  const db = await openDb(':memory:');
  const couch = await addInventoryItem(db, {
    name: 'West Elm Harmony Sofa',
    description: 'Deep seats, down-filled cushions. Performance velvet, dusty blush.',
    qty: 1,
    cost: 240,
    currentRetail: 1499,
    acquiredAt: '2026-08-15',
  });
  assert.equal(couch.status, 'in-stock');
  const lamp = await addInventoryItem(db, { name: 'Floor lamp', cost: 12 });

  const sold = await updateInventoryItem(db, lamp.id, { status: 'sold' });
  assert.equal(sold.status, 'sold');
  assert.deepEqual(
    (await listInventory(db)).map((i) => i.name),
    ['West Elm Harmony Sofa', 'Floor lamp'],
    'sold items sink to the bottom',
  );

  await assert.rejects(addInventoryItem(db, { name: '  ' }));
  await assert.rejects(addInventoryItem(db, { name: 'x', cost: -1 }));
  await assert.rejects(addInventoryItem(db, { name: 'x', qty: 0 }));
  await assert.rejects(updateInventoryItem(db, couch.id, { status: 'lost' as never }));

  await deleteInventoryItem(db, couch.id);
  assert.equal((await listInventory(db)).length, 1);
});

test('deleting an inventory item unlinks its calendar events', async () => {
  const db = await openDb(':memory:');
  const sofa = await addInventoryItem(db, { name: 'Sofa' });
  await addEvent(db, { title: 'Viewing', kind: 'viewing', date: '2026-09-02', inventoryId: sofa.id });
  await deleteInventoryItem(db, sofa.id);
  const [event] = await listEvents(db);
  assert.equal(event.title, 'Viewing', 'event survives');
  assert.equal(event.inventoryId, null, 'link nulled');
});

test('events: add with validation, range listing, delete', async () => {
  const db = await openDb(':memory:');
  await addEvent(db, { title: 'Deliver sofa to Cambridge', kind: 'delivery', date: '2026-08-25', time: '14:30', contact: 'Sam 617-555-0101' });
  await addEvent(db, { title: 'Viewing: sectional', kind: 'viewing', date: '2026-09-02' });
  await addEvent(db, { title: 'Pallet pickup', kind: 'pickup', date: '2026-09-15' });

  await assert.rejects(addEvent(db, { title: '', kind: 'other', date: '2026-08-25' }));
  await assert.rejects(addEvent(db, { title: 'x', kind: 'party' as never, date: '2026-08-25' }));
  await assert.rejects(addEvent(db, { title: 'x', kind: 'other', date: 'someday' }));
  await assert.rejects(addEvent(db, { title: 'x', kind: 'other', date: '2026-08-25', time: '25:99' }));

  const sept = await listEvents(db, '2026-09-01', '2026-09-30');
  assert.deepEqual(sept.map((e) => e.title), ['Viewing: sectional', 'Pallet pickup']);

  const all = await listEvents(db);
  assert.equal(all.length, 3);
  await deleteEvent(db, all[0].id);
  assert.equal((await listEvents(db)).length, 2);
});
