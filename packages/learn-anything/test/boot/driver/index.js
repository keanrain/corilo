// Test driver: create one Session under the learn-tutor preset, send one
// message, print the transcript event types, and exit.
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { createReminders } from '../../../src/host/reminder.js';
export const name = 'la-driver';
export const inject = ['agentDefaultModel', 'agents', 'sessions', 'agentPresets', 'schedule'];
export function apply(ctx) {
  const exit = ctx.get('appExit');
  (async () => {
    await ctx.get('loader')?.await();
    const presets = ctx.get('agentPresets');
    const { id } = await presets.resolve(undefined);
    console.error('[driver] default preset =', id);
    const sel = ctx.get('agentDefaultModel').currentSelection();
    const { agent } = await ctx.get('agents').create({
      sessionId: `session-${randomUUID()}`,
      meta: { cwd: process.cwd(), agentPreset: id },
      agentOptions: { provider: sel.provider, model: sel.model },
      setup: async (agentCtx) => { await presets.mount(agentCtx, id); },
    });
    // Headless has no Web Session controller; the embedding owns its live Agent.
    ctx.on('schedule/resolve-agent', async (sessionId, next) => sessionId === agent.session.id ? agent : next());
    await agent.whenIdle();
    const schedule = ctx.get('schedule');
    const reminders = createReminders(schedule, { time: '23:59', timeZone: 'Asia/Taipei' });
    const reminder = await reminders.ensure(process.cwd(), agent.session.id);
    const paused = await schedule.edit({ id: reminder.id, action: 'update', patch: { active: false } }, agent.session.id);
    assert.equal(paused.status, 'paused');
    assert.equal((await reminders.ensure(process.cwd(), agent.session.id)).status, 'paused');
    assert.equal((await schedule.catalog()).length, 1, 'automatic checks do not duplicate paused reminders');
    const restored = await reminders.ensure(process.cwd(), agent.session.id, '23:58');
    assert.equal(restored.id, reminder.id);
    assert.equal(restored.status, 'active');
    await schedule.edit({ id: reminder.id, action: 'delete' }, agent.session.id);
    assert.equal(await reminders.ensure(process.cwd(), agent.session.id), null);
    console.error('[driver] native reminder create/pause/restore/delete passed');
    const snap = await ctx.get('skills')?.snapshot({ cwd: process.cwd(), scope: agent, signal: AbortSignal.timeout(20000) });
    console.error('[driver] skills complete=', snap?.complete, (snap?.skills ?? []).map((s) => s.name + '@' + (s.path ?? '')).join(' '));
    agent.followup({ role: 'user', content: [{ type: 'text', text: process.env.LA_TASK ?? '我想学习函数' }], source: { kind: 'user' } });
    await agent.whenIdle();
    const prompt = 'boot-only scheduled reminder';
    const due = await schedule.create({ title: 'boot due', prompt,
      timing: { kind: 'after', after_seconds: 1 }, target: { kind: 'session', sessionId: agent.session.id } }, agent.session.id);
    const blocked = await schedule.create({ title: 'boot paused', prompt: 'boot-only paused reminder',
      timing: { kind: 'after', after_seconds: 1 }, target: { kind: 'session', sessionId: agent.session.id } }, agent.session.id);
    await schedule.edit({ id: blocked.id, action: 'update', patch: { active: false } }, agent.session.id);
    const deadline = Date.now() + 10000;
    while (!(await schedule.history({ id: due.id, limit: 10 })).records?.length && Date.now() < deadline) await delay(100);
    await agent.whenIdle();
    await delay(350);
    const delivered = await schedule.history({ id: due.id, limit: 10 });
    assert.equal(delivered.records.length, 1, 'one due occurrence is durably acknowledged exactly once');
    assert.equal(delivered.records[0].targetSessionId, agent.session.id);
    assert.equal(delivered.records[0].prompt, prompt);
    assert.equal((await schedule.history({ id: blocked.id, limit: 10 })).records.length, 0, 'paused task is not delivered');
    const entries = await schedule.catalog();
    assert.equal(entries.find((entry) => entry.id === due.id).status, 'ended');
    assert.equal(entries.find((entry) => entry.id === blocked.id).status, 'paused');
    const scheduleMessages = Array.from({ length: agent.session.seq }, (_, seq) => agent.session.eventAt(seq))
      .filter((event) => event?.type === 'user/message' && event.data.source?.kind === 'schedule');
    assert.equal(scheduleMessages.filter((event) => JSON.stringify(event.data.content).includes(prompt)).length, 1);
    assert.ok(!scheduleMessages.some((event) => JSON.stringify(event.data.content).includes('boot-only paused reminder')));
    await schedule.edit({ id: due.id, action: 'delete' }, agent.session.id);
    await schedule.edit({ id: blocked.id, action: 'delete' }, agent.session.id);
    console.error('[driver] native timer delivery/paused/exactly-once passed');
    const types = [];
    for (let s = 0; s < agent.session.seq; s++) types.push(agent.session.eventAt(s)?.type);
    console.error('[driver] events:', types.join(' '));
    exit(0);
  })().catch((e) => { console.error('[driver] FAIL', e); exit(1); });
}
