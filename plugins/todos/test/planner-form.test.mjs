import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createNoticeDismisser, isTransientNotice } from '../client/planner-notices.mjs';
import { toggleAllDay, formEnd, storageEnd, eventEndError, moreHasValue, eventViews } from '../client/planner-form.mjs';
import { shiftStart } from '../client/planner-dates.mjs';

function harness(initial = '') {
  let state = { notice: initial };
  const timers = new Map();
  let next = 1;
  const d = createNoticeDismisser({
    get: () => state,
    set: (patch) => { state = { ...state, ...patch }; },
    delay: 3000,
    setTimer: (fn, ms) => { timers.set(next, { fn, ms }); return next++; },
    clearTimer: (id) => timers.delete(id),
  });
  return { d, state: () => state, timers, put: (notice) => { state = { ...state, notice }; } };
}

test('only success notices are transient; errors, conflicts and unknown states persist', () => {
  for (const n of ['已添加', '已保存', '任务已完成', '任务已恢复']) assert.equal(isTransientNotice(n), true, n);
  for (const n of ['保存结果未知，请先核对操作', '版本冲突，请查看最新记录', '未找到回执，可重试原请求', '调整尚未保存，请核对并保存',
    '未保存', '提交快照已保存，后续输入仍未保存', '保存失败', '任务已更新，请核对后重试', '']) assert.equal(isTransientNotice(n), false, n);
});

test('a success notice clears after 3 seconds, and a persistent one never schedules', () => {
  const h = harness('已添加');
  h.d.schedule('已添加');
  assert.equal([...h.timers.values()][0].ms, 3000);
  [...h.timers.values()][0].fn();
  assert.equal(h.state().notice, '');
  const p = harness('保存失败');
  p.d.schedule('保存失败');
  assert.equal(p.timers.size, 0);
});

test('a timer never wipes a newer notice, and dispose cancels pending timers', () => {
  const h = harness('已保存');
  h.d.schedule('已保存');
  const fn = [...h.timers.values()][0].fn;
  h.put('版本冲突，请查看最新记录');
  fn();
  h.timers.clear();
  assert.equal(h.state().notice, '版本冲突，请查看最新记录');
  h.put('已保存');
  h.d.schedule('已保存');
  h.d.schedule('已保存');
  assert.equal(h.timers.size, 1, 'rescheduling replaces the earlier timer');
  h.d.dispose();
  assert.equal(h.timers.size, 0);
});

test('unchecking all-day keeps the chosen date and uses the event zone', () => {
  const v = { allDay: true, start: '2027-03-10', end: '2027-03-11', timeZone: 'Asia/Tokyo' };
  const t = toggleAllDay(v, false);
  assert.equal(t.start, '2027-03-10T00:00:00Z');
  assert.equal(t.end, '2027-03-10T00:30:00Z');
  assert.equal(t.allDay, false);
});

test('checking all-day takes the start date in the event zone and ends the next day', () => {
  // 2027-03-10T20:00Z is already 03-11 in Tokyo.
  const v = { allDay: false, start: '2027-03-10T20:00:00Z', end: '2027-03-10T21:00:00Z', timeZone: 'Asia/Tokyo' };
  assert.deepEqual(toggleAllDay(v, true), { allDay: true, start: '2027-03-11', end: '2027-03-12' });
});

test('a nonexistent 09:00 is an error, never a guess', () => {
  // Pacific/Apia skipped 2011-12-30 entirely, so 09:00 does not exist.
  const v = { allDay: true, start: '2011-12-30', end: '2011-12-31', timeZone: 'Pacific/Apia' };
  assert.throws(() => toggleAllDay(v, false));
});

test('all-day end is shown inclusive and converted back to the exclusive storage value', () => {
  const v = { allDay: true, start: '2026-12-01', end: '2026-12-02' };
  assert.equal(formEnd(v), '2026-12-01');
  assert.equal(storageEnd('2026-12-01'), '2026-12-02');
  assert.equal(formEnd({ allDay: false, end: '2026-12-01T10:00:00Z' }), '2026-12-01T10:00:00Z');
  assert.equal(formEnd({ allDay: true, end: '' }), '');
  assert.equal(storageEnd(''), '');
});

test('an inclusive end before the start is a validation error', () => {
  assert.equal(eventEndError({ allDay: true, start: '2026-12-01', end: '2026-12-02' }), '');
  assert.equal(eventEndError({ allDay: true, start: '2026-12-05', end: '2026-12-05' }), '结束日期不能早于开始日期');
  assert.equal(eventEndError({ allDay: true, start: '2026-12-05', end: '2026-12-03' }), '结束日期不能早于开始日期');
  assert.equal(eventEndError({ allDay: false, start: 'x', end: 'y' }), '');
});

test('shifting an all-day start keeps the duration in storage format', () => {
  const v = { allDay: true, start: '2026-12-01', end: '2026-12-04', timeZone: 'UTC' };
  const s = shiftStart(v, '2026-12-10');
  assert.equal(s.end, '2026-12-13');
  assert.equal(formEnd(s), '2026-12-12');
});

test('the folded section opens when any folded field holds non-default data', () => {
  const zone = 'Asia/Shanghai';
  const task = { body: '', status: 'open', list: '', priority: 'normal', due: null };
  assert.equal(moreHasValue('task', task, zone), false);
  assert.equal(moreHasValue('task', { ...task, due: { kind: 'date', date: '2026-12-01', timeZone: zone } }, zone), false);
  for (const patch of [{ body: 'x' }, { status: 'done' }, { list: 'w' }, { priority: 'high' },
    { due: { kind: 'date', date: '2026-12-01', timeZone: 'UTC' } }]) assert.equal(moreHasValue('task', { ...task, ...patch }, zone), true, JSON.stringify(patch));
  const ev = { body: '', status: 'active', location: '', taskId: null, timeZone: zone };
  assert.equal(moreHasValue('event', ev, zone), false);
  for (const patch of [{ body: 'x' }, { status: 'cancelled' }, { location: 'r' }, { taskId: 't1' }, { timeZone: 'UTC' }]) assert.equal(moreHasValue('event', { ...ev, ...patch }, zone), true, JSON.stringify(patch));
});

test('the new-event button is offered only where saved events are visible', () => {
  assert.deepEqual(eventViews, ['today', 'calendar']);
});
