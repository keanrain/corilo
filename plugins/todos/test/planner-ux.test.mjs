import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Temporal } from '../client/planner-dates.mjs';
import { newTaskDefaults } from '../client/planner-defaults.mjs';
import { initialZone, saveZone, savedZone, validZone } from '../client/planner-zone.mjs';

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return { getItem: (k) => values.get(k) ?? null, setItem: (k, v) => values.set(k, String(v)), values };
}

test('a task added from Today or Future keeps a date that leaves it in that view', () => {
  const zone = 'Asia/Shanghai';
  const today = Temporal.Now.plainDateISO(zone);
  assert.deepEqual(newTaskDefaults({ view: 'today', list: '', zone }), { plannedDate: today.toString() });
  assert.deepEqual(newTaskDefaults({ view: 'future', list: '', zone }), { plannedDate: today.add({ days: 1 }).toString() });
  assert.deepEqual(newTaskDefaults({ view: 'inbox', list: '', zone }), {});
  assert.deepEqual(newTaskDefaults({ view: 'all', list: '工作', zone }), { list: '工作' });
  assert.deepEqual(newTaskDefaults({ view: 'done', list: '工作', zone }), {});
});

test('the display zone applies without a confirmation step and survives a reload', () => {
  const storage = memoryStorage();
  const first = initialZone(storage);
  assert.equal(first.confirmed, true, 'a valid device zone is applied immediately');
  saveZone('America/New_York', storage);
  assert.deepEqual(initialZone(storage), { zone: 'America/New_York', confirmed: true });
});

test('an invalid or unreadable stored zone falls back to the device zone', () => {
  assert.equal(savedZone(memoryStorage({ 'corilo-todos-display-zone': 'Mars/Olympus' })), null);
  const throwing = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } };
  assert.equal(savedZone(throwing), null);
  assert.doesNotThrow(() => saveZone('UTC', throwing));
  assert.equal(initialZone(throwing).confirmed, true);
  assert.equal(validZone(''), false);
  assert.equal(validZone('UTC'), true);
});
