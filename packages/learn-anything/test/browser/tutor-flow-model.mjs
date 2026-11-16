// Deterministic local Anthropic fixture for the native Web teaching-flow test.
// Tool calls are planned, but executed by the real tutor and examiner host.
import http from 'node:http'
import { readFileSync, appendFileSync } from 'node:fs'
const config = JSON.parse(readFileSync(process.env.FLOW_CONFIG, 'utf8'))
let serial = 0
http.createServer((req, res) => {
  let body = ''
  req.on('data', (chunk) => { body += chunk })
  req.on('end', () => {
    const input = JSON.parse(body)
    appendFileSync(process.env.FLOW_REQUESTS, body + '\n')
    const messages = input.messages
    const examiner = JSON.stringify(input.messages).includes('这是宿主发起的正式判题')
    let content
    if (examiner) content = [{ type: 'text', text: JSON.stringify({ verdict: 'correct', questionType: JSON.stringify(input.messages).includes(config.questions[2]) ? 'rephrase' : JSON.stringify(input.messages).includes(config.questions[1]) ? 'discriminate-neg' : 'scenario', difficulty: 1, novel: true, explainedRule: true, feedback: '能把规则用于新情境。', output: '新增净收益 30 元，应该追加。' }) }]
    else {
      let userIndex = -1, userText = ''
      for (let i = messages.length - 1; i >= 0; i--) {
        const message = messages[i]
        const text = typeof message.content === 'string' ? message.content : (message.content ?? []).filter((x) => x.type === 'text').map((x) => x.text).join('\n')
        if (message.role === 'user' && text) { userIndex = i; userText = text; break }
      }
      const shown = messages.flatMap((m) => Array.isArray(m.content) ? m.content : []).filter((x) => x.type === 'tool_use' && x.name === 'quiz_show').at(-1)?.input?.question
      const quizIndex = config.questions.indexOf(shown)
      const stage = userText.includes('FLOW_PLAN') ? 'plan' : userText.includes('FLOW_LEARN') ? 'learn' : /FLOW_QUIZ_(\d)/.test(userText) ? 'quiz' + /FLOW_QUIZ_(\d)/.exec(userText)[1] : userText.includes('FLOW_REVIEW') ? 'review' : 'grade' + quizIndex
      const done = messages.slice(userIndex + 1).flatMap((m) => Array.isArray(m.content) ? m.content : []).filter((x) => x.type === 'tool_use').length
      const step = config[stage][done]
      if (step) content = [{ type: 'tool_use', id: `flow-${++serial}`, name: step.name, input: step.args }]
      else {
        const references = [...JSON.stringify(messages.slice(userIndex + 1)).matchAll(/learn-card:([^\\\s)]+)/g)].map((match) => match[1])
        content = [{ type: 'text', text: `${stage} 完成。\n\n` + (stage === 'review' ? messages.at(-1).content.filter((b) => b.type === 'tool_result').map((b) => typeof b.content === 'string' ? b.content : JSON.stringify(b.content)).join('\n') + '\n\n' : '') + [...new Set(references)].map((ref) => `[学习卡片](learn-card:${ref})`).join('\n\n') }]
      }
    }
    const id = `flow-message-${++serial}`
    if (!input.stream) { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ id, type: 'message', role: 'assistant', model: input.model, stop_reason: 'end_turn', content, usage: { input_tokens: 1, output_tokens: 1 } })); return }
    res.writeHead(200, { 'content-type': 'text/event-stream' })
    const event = (type, data) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`)
    event('message_start', { message: { id, type: 'message', role: 'assistant', model: input.model, content: [], stop_reason: null, usage: { input_tokens: 1, output_tokens: 1 } } })
    content.forEach((block, index) => {
      event('content_block_start', { index, content_block: block.type === 'text' ? { type: 'text', text: '' } : { type: 'tool_use', id: block.id, name: block.name, input: {} } })
      event('content_block_delta', { index, delta: block.type === 'text' ? { type: 'text_delta', text: block.text } : { type: 'input_json_delta', partial_json: JSON.stringify(block.input) } })
      event('content_block_stop', { index })
    })
    event('message_delta', { delta: { stop_reason: content[0].type === 'tool_use' ? 'tool_use' : 'end_turn', stop_sequence: null }, usage: { output_tokens: 1 } })
    event('message_stop', {})
    res.end()
  })
}).listen(Number(process.env.FLOW_MODEL_PORT), '127.0.0.1', () => console.log('ready'))
