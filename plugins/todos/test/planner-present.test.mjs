import { test } from 'node:test';
import assert from 'node:assert/strict';
import { plannerDraftChanged, plannerDateLabel } from '../client/planner-present.mjs';

test('draft checks allow clean close after opening/saving and retain meaningful unsaved changes', () => {
  const item = { id: 'id', version: 1, createdAt: 'then', title: '任务', body: '', priority: 'normal', due: null };
  const value = { title: '任务', body: '', priority: 'normal', due: null };
  assert.equal(plannerDraftChanged(null), false);
  assert.equal(plannerDraftChanged({ item, value }), false);
  assert.equal(plannerDraftChanged({ item: null, initial: value, value: { ...value } }), false);
  assert.equal(plannerDraftChanged({ item: null, initial: value, value: { ...value, priority: 'high' } }), true);
  assert.equal(plannerDraftChanged({ item, value: { ...value, body: '未保存' } }), true);
  assert.equal(plannerDraftChanged({ item: { ...item, body: '已保存', version: 2 }, value: { ...value, body: '已保存' } }), false);
});

test('calendar dates stay on their original day while exact instants follow the display zone', () => {
  const now = new Date('2026-06-01T12:00:00Z');
  for (const zone of ['Pacific/Honolulu', 'Pacific/Kiritimati', 'America/New_York']) {
    assert.equal(plannerDateLabel('2026-01-01', 'en-US', zone, now), 'Jan 1');
  }
  assert.match(plannerDateLabel('2026-01-01T01:00:00Z', 'en-US', 'America/Los_Angeles', now), /Dec 31/);
  assert.match(plannerDateLabel('2026-01-01T01:00:00Z', 'en-US', 'Asia/Taipei', now), /Jan 1/);
  assert.match(plannerDateLabel('2027-01-01', 'en-US', 'UTC', now), /2027/);
  assert.match(plannerDateLabel('2026-01-01', 'en-US', 'Pacific/Honolulu', new Date('2026-01-01T01:00:00Z')), /2026/);
  assert.equal(plannerDateLabel('bad', 'en-US'), 'bad');
  assert.equal(plannerDateLabel(null, 'en-US'), '');
  assert.equal(plannerDateLabel('2026-01-01', 'invalid locale'), '2026-01-01');
});
