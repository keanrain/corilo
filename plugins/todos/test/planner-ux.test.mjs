import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Temporal } from '../client/planner-dates.mjs';
import { newTaskDefaults } from '../client/planner-defaults.mjs';
import { exactLabel, isPast, reminderShortcuts, resolveLocal, splitInstant } from '../client/planner-time.mjs';
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


test('wall-clock input resolves in the record zone and round-trips', () => {
  assert.deepEqual(resolveLocal('2026-11-18', '09:00', 'Asia/Shanghai'), { kind: 'exact', instant: '2026-11-18T01:00:00Z' });
  assert.deepEqual(splitInstant('2026-11-18T01:00:00Z', 'Asia/Shanghai'), { date: '2026-11-18', time: '09:00' });
  assert.deepEqual(resolveLocal('2026-11-18', '', 'UTC'), { kind: 'incomplete' });
  assert.equal(exactLabel('2027-03-05T15:00:00Z', 'America/New_York'), '2027-03-05 10:00 (UTC-05:00)');
});

test('gap and overlap times are never guessed; both explicit offsets are offered', () => {
  const overlap = resolveLocal('2026-11-01', '01:30', 'America/New_York');
  assert.equal(overlap.kind, 'ambiguous');
  assert.deepEqual(overlap.candidates.map((c) => c.instant), ['2026-11-01T05:30:00Z', '2026-11-01T06:30:00Z']);
  assert.deepEqual(overlap.candidates.map((c) => c.label), ['01:30 (UTC-04:00)', '01:30 (UTC-05:00)']);
  const gap = resolveLocal('2026-03-08', '02:30', 'America/New_York');
  assert.equal(gap.kind, 'missing');
  assert.equal(gap.candidates.length, 2);
  for (const c of gap.candidates) assert.match(c.label, /\(UTC-0[45]:00\)$/);
});

test('reminder shortcuts are future instants only and past reminders are flagged', () => {
  const now = Temporal.Instant.from('2026-11-18T03:00:00Z'); // 11:00 in Shanghai
  const task = reminderShortcuts({ plannedDate: '2026-11-18', due: null }, 'task', 'Asia/Shanghai', now);
  assert.deepEqual(task.map((s) => s.key), ['tomorrow-9'], 'today 9:00 already passed');
  assert.equal(task[0].instant, '2026-11-19T01:00:00Z');
  const event = reminderShortcuts({ allDay: false, start: '2026-11-18T06:00:00Z' }, 'event', 'Asia/Shanghai', now);
  assert.deepEqual(event.map((s) => s.instant), ['2026-11-18T05:45:00Z', '2026-11-18T05:00:00Z']);
  assert.equal(isPast('2026-11-18T02:00:00Z', now), true);
  assert.equal(isPast('2026-11-18T04:00:00Z', now), false);
});
