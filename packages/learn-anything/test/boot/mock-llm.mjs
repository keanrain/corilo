import http from 'node:http';
import fs from 'node:fs';
import { join } from 'node:path';
// Minimal Anthropic Messages endpoint for boot checks: records every request
// body under $MOCK_OUT and plays a scripted tool sequence (MOCK_PLAN); tool
// inputs come from MOCK_INPUTS ({"tool": {...}}) when given. MOCK_CONFIG names a
// JSON file {plan, inputs} re-read per request, so one server can serve
// several scripted sessions. Non-streaming
// requests from the eval's simulated learner get a canned answer, and those
// from the eval's prescription judge a passing verdict.
const OUT = process.env.MOCK_OUT;
const PORT = Number(process.env.MOCK_PORT ?? 18799);
let n = 0;
const sysText = (j) => (Array.isArray(j.system) ? j.system.map((b) => b.text).join('\n') : j.system ?? '');
function decide(j) {
  const sys = sysText(j);
  const cfg = process.env.MOCK_CONFIG && fs.existsSync(process.env.MOCK_CONFIG) ? JSON.parse(fs.readFileSync(process.env.MOCK_CONFIG, 'utf8')) : {};
  if (JSON.stringify(j.messages).includes('这是宿主发起的正式判题')) {
    const input = cfg.plan?.find?.((step) => step.name === 'verification_record')?.input ?? {};
    return [{ type: 'text', text: JSON.stringify({ verdict: 'correct', questionType: input.questionType ?? 'scenario', difficulty: 2, novel: true, explainedRule: true, feedback: 'mock host grading', output: 'mock standard' }) }];
  }
  if (!j.tools?.length) return [{ type: 'text', text: '标题' }];
  if (/考官|判分要点/.test(sys) && !/学习导师/.test(sys)) return [{ type: 'text', text: '【题目】示例题' }];
  if (/你是「校验员」/.test(sys)) return [{ type: 'text', text: cfg.checkerReply ?? 'rule：通过 —— mock 校验' }];
  const last = j.messages.at(-1);
  const results = (last.content || []).filter?.((b) => b.type === 'tool_result') ?? [];
  const toolNames = Object.fromEntries(j.messages.flatMap((m) => (Array.isArray(m.content) ? m.content : [])).filter((b) => b.type === 'tool_use').map((b) => [b.id, b.name]));
  const done = results.map((r) => toolNames[r.tool_use_id]);
  const plan = cfg.plan ?? process.env.MOCK_PLAN ?? 'learn_status,examiner';
  const called = Object.values(toolNames);
  if (cfg.pauseAfter?.some((tool) => done.includes(tool))) return [{ type: 'text', text: '请在卡片里作答。' }];
  const entry = Array.isArray(plan) ? plan[called.length] : plan.split(',').find((t) => !called.includes(t));
  const next = typeof entry === 'object' ? entry.name : entry;
  if (!next) return [{ type: 'text', text: '完成' }];
  const inputs = cfg.inputs ?? JSON.parse(process.env.MOCK_INPUTS ?? '{}');
  const input = entry?.input ?? inputs[next] ?? (next === 'examiner' ? { description: '出题', prompt: '为知识点「函数」出一道判别反例题' }
    : next === 'skill' ? { name: 'plan-course' } : {});
  return [{ type: 'tool_use', id: 'tu_' + n, name: next, input }];
}
http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    n++;
    fs.writeFileSync(join(OUT, `req-${String(n).padStart(3, '0')}.json`), body);
    const j = JSON.parse(body);
    if (!j.stream) {
      const text = /处方评审/.test(sysText(j)) ? '{"fit": true, "reason": "mock"}' : '我记得定义是这么说的，但换个说法我就不太确定了。';
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ id: 'msg_' + n, type: 'message', role: 'assistant', model: j.model, stop_reason: 'end_turn',
        content: [{ type: 'text', text }], usage: { input_tokens: 1, output_tokens: 1 } }));
      return;
    }
    const content = decide(j);
    const stop = content[0].type === 'tool_use' ? 'tool_use' : 'end_turn';
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    const ev = (t, d) => res.write(`event: ${t}\ndata: ${JSON.stringify({ type: t, ...d })}\n\n`);
    ev('message_start', { message: { id: 'msg_' + n, type: 'message', role: 'assistant', model: j.model, content: [], stop_reason: null, usage: { input_tokens: 1, output_tokens: 1 } } });
    content.forEach((b, i) => {
      if (b.type === 'text') {
        ev('content_block_start', { index: i, content_block: { type: 'text', text: '' } });
        ev('content_block_delta', { index: i, delta: { type: 'text_delta', text: b.text } });
      } else {
        ev('content_block_start', { index: i, content_block: { type: 'tool_use', id: b.id, name: b.name, input: {} } });
        ev('content_block_delta', { index: i, delta: { type: 'input_json_delta', partial_json: JSON.stringify(b.input) } });
      }
      ev('content_block_stop', { index: i });
    });
    ev('message_delta', { delta: { stop_reason: stop, stop_sequence: null }, usage: { output_tokens: 1 } });
    ev('message_stop', {});
    res.end();
  });
}).listen(PORT, '127.0.0.1', () => console.log('mock up'));
