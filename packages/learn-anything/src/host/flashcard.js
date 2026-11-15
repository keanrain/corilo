import { randomBytes } from 'node:crypto'
import { requireCourse, requireKp } from './store.js'
import { factsWithIds } from './mastery.js'
import { validateSources } from './ingest.js'
import { marker } from './render.js'

export const flashcardShowTool = {
  name: 'flashcard_show',
  readOnly: true,
  description: 'Show a saved information fact as a flip flashcard for recall and self-check. This is self-study, not verification: flipping or self-rating never proves mastery. End the turn and wait for the learner. Use quiz_show for a graded recall.',
  parameters: {
    kpId: { type: 'string', required: true, description: '当前课程中的 information 知识点 id' },
    factId: { type: 'string', description: '已保存的记忆卡 id；有多张时必填' },
  },
  async execute(args, exec) {
    const cwd = exec?.agent?.session?.header.cwd ?? process.cwd()
    const course = await requireCourse(cwd)
    if (!course.chapters.some((ch) => ch.kpIds.includes(args.kpId))) throw new Error('知识点不在当前课程中，请先查看 course_get')
    const kp = await requireKp(cwd, args.kpId)
    if (kp.kind !== 'information') throw new Error('翻面闪卡仅用于 information 知识点')
    const facts = factsWithIds(kp)
    if (!facts.length) throw new Error('请先用 kp_define_models 保存记忆卡')
    if (!args.factId && facts.length > 1) throw new Error('有多张记忆卡，请指定 factId')
    const fact = args.factId ? facts.find((f) => f.id === args.factId) : facts[0]
    if (!fact) throw new Error('factId 不存在，请用 kp_get 查看有效记忆卡 id')
    if (!fact.prompt?.trim() || !fact.answer?.trim()) throw new Error('记忆卡问题和答案不能为空')
    const sources = await validateSources(cwd, kp.sources)
    const id = `f-${Date.now().toString(36)}${randomBytes(3).toString('hex')}`
    return `已展示自测闪卡：${fact.prompt}\n请结束本轮，等待学习者回忆后翻面。翻面和【闪卡自评】都不是验证证据，不写入 verification_record；若要确认掌握，请另出未揭晓答案的回忆题。\n${marker({ view: 'flashcard', id, kp: { id: kp.id, title: kp.title }, fact: { id: fact.id, prompt: fact.prompt, answer: fact.answer }, sources })}`
  },
}
