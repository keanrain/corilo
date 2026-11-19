/**
 * The tutor's `examiner` and `checker`: each starts one child under its own agent
 * preset (persona + read-only tools, declared in cordis.patch.yml) through the
 * subagent service and returns the child's final text as the tool result. The
 * stock `subagent` tool only starts a background child whose result arrives in a
 * later turn; caller delivery keeps question, grading and checking inside the
 * tutor's current turn.
 * @module learn-anything/delegates
 */
import { validateSources } from './ingest.js'

// Keep reasoning enabled for the examiner without inheriting the tutor's high/max budget.
export const EXAMINER_EFFORT = 'low'

export const DELEGATES = [
  {
    name: 'examiner',
    preset: 'learn-examiner',
    // Read-only child: it may run in the same step as verification_record, so the next question is written while the answer is graded.
    concurrencySafe: true,
    reasoningEffort: EXAMINER_EFFORT,
    description:
      'The examiner subagent. It cannot see this conversation: put everything it needs in `prompt`. ' +
      'Without a learner answer it writes ONE new-situation question (题目 / 题型 / 标准答案 / 判分要点); ' +
      'with the question, reference answer, grading points and the learner\'s answer verbatim it grades and attributes the answer. ' +
      'Returns its reply; show the learner only the question.',
  },
  {
    name: 'checker',
    preset: 'learn-checker',
    description:
      'The checker subagent. It cannot see this conversation: give it the rule and the numbered examples to check in `prompt`. ' +
      'It checks each AI- or learner-made example against the rule and the sources and returns a verdict per example.',
  },
]

const PARAMETERS = {
  description: { type: 'string', required: true, description: '一句话任务标签（3–8 个字），例如「出题：闭包判别」' },
  prompt: { type: 'string', required: true, description: '完整的任务说明' },
  sources: { type: 'array', items: { type: 'string' }, description: '本任务实际依据的材料块 id 或已核对的 URL；出题和判题使用同一组，子 agent 读取原文核对' },
}

function textOf(blocks) {
  return (blocks ?? []).filter((b) => b?.type === 'text').map((b) => b.text).join('\n').trim()
}

/**
 * @param subagents - the dsh-subagent service
 * @param provider - local provider name that accepts an independent preset (`spawn`)
 */
export function delegateTool(subagents, provider, { name, preset, description, reasoningEffort, concurrencySafe }) {
  return {
    name,
    description,
    ...(concurrencySafe ? { concurrencySafe } : {}),
    parameters: name === 'examiner' ? {
      ...PARAMETERS,
      reasoningEffort: { type: 'string', enum: ['low', 'high'], description: '普通出题和判题用 low（默认）；OrderSteps 排序推演、较长的多步计算或需反复核对的复杂约束用 high。保留推理，不改变模型。' },
    } : PARAMETERS,
    async execute(args, exec) {
      if (!exec.agent) throw new Error(`${name} needs a calling agent`)
      const sources = await validateSources(exec.agent.session?.header.cwd ?? process.cwd(), args.sources)
      const prompt = args.prompt + (sources.length ? `\n\n【教材依据】\n${sources.join('\n')}` : '')
      const activation = await subagents.startActivation({
        provider,
        label: args.description,
        prompt: [{ type: 'text', text: prompt }], parent: exec.agent, agentPreset: preset, maxDepth: 1,
        ...(reasoningEffort ? { agentOptions: { reasoningEffort: args.reasoningEffort ?? reasoningEffort } } : {}),
        signal: exec.signal,
        delivery: 'caller',
      })
      const onAbort = () => { activation.dispose().catch(() => {}) }
      exec.signal.addEventListener('abort', onAbort, { once: true })
      try {
        const result = await activation.result
        const text = textOf(result.output)
        if (result.stopReason === 'completed') return text || `（${name} 没有给出回复）`
        return `${name} 未完成（${result.stopReason}${result.diagnostic ? `：${result.diagnostic}` : ''}）${text ? `\n部分输出：\n${text}` : ''}`
      } finally {
        exec.signal.removeEventListener('abort', onAbort)
      }
    },
  }
}
