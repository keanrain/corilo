/**
 * The interactive-quiz component library (OpenUI Lang), shared by both halves:
 * the Host builds it without renderers to write the examiner's language section and
 * to validate a quiz before showing it (src/host/quiz.js); the Web half passes its
 * React renderers (src/client/quiz.js). Components only lay a question out and
 * collect the learner's answer: no prop marks a choice as correct, so a quiz cannot
 * carry its standard answer, which stays with the tutor and the examiner.
 * @module learn-anything/quiz
 */
import { z } from 'zod/v4'
import { createLibrary, createParser, defineComponent } from '../vendor/openui-lang-core.js'

export const ROOT = 'Quiz'

/** Question types, as in prompts/examiner.md. */
export const QUESTION_TYPES = ['scenario', 'predict', 'discriminate-pos', 'discriminate-neg', 'contrast', 'rephrase', 'own-examples', 'transfer', 'recall']

/** The interactive components: each collects one answer, keyed by its prompt. */
export const ANSWER_COMPONENTS = ['Choice', 'Pick', 'Slider', 'Sorter', 'Rewrite', 'Examples', 'SpotError', 'OrderSteps', 'Counterexample', 'MinimalChange', 'DualPredict', 'TransferTask', 'Reason']

/**
 * @param {Record<string, unknown>} [renderers] component name → framework renderer
 * @returns the library; with no renderers, for prompts and validation only
 */
export function quizLibrary(renderers = {}) {
  const def = (name, description, props) => defineComponent({ name, description, props, component: renderers[name] ?? null })

  const Scene = def('Scene', '情境卡：把题目的情境讲成一个小场景（谁、在哪、遇到了什么），放在提问之前。', z.object({
    text: z.string().describe('情境正文，2～4 句；背景与已知条件用换行分段；多个条件用 - 列表，少量 **重点** 或 `术语`，不标答案'),
    who: z.string().optional().describe('情境里的人物或身份，如「新手店长小林」'),
  }))
  const Card = def('Card', 'Pick 里的一张候选卡片。', z.object({
    title: z.string().describe('卡片标题：一个对象、做法或说法'),
    detail: z.string().optional().describe('一句补充说明'),
  }))
  const Pick = def('Pick', '找冒牌货：一组卡片，学习者点出不属于（或属于）某概念的那张。适合判别题、对比辨析。', z.object({
    prompt: z.string().describe('要学习者做什么，如「哪一张不是 A？」'),
    cards: z.array(Card.ref).describe('3～5 张卡片，表面要相似'),
    multi: z.boolean().optional().describe('可多选时为 true'),
  }))
  const Choice = def('Choice', '选择或判断：给几个选项，学习者选一个（multi 时可多选）。判断题用「是 / 不是」或「会 / 不会」两个选项。', z.object({
    prompt: z.string().describe('问题'),
    options: z.array(z.string()).describe('2～5 个选项，不标对错'),
    multi: z.boolean().optional().describe('可多选时为 true'),
  }))
  const Reason = def('Reason', '理由框：请学习者用自己的话写出判断依据或举例。几乎每道题都要有，判分要看「能否说清规律」。', z.object({
    prompt: z.string().describe('如「为什么？用你自己的话说说依据」'),
    placeholder: z.string().optional().describe('输入框里的提示，不能暗示答案'),
  }))
  const Slider = def('Slider', '滑块预测：学习者拖动滑块估一个数（多少、几成、涨还是跌多少）。适合结果是数量的预测题。', z.object({
    prompt: z.string().describe('要估的量，如「排队的人会变成多少？」'),
    min: z.number().describe('最小值'),
    max: z.number().describe('最大值；答案不能正好落在两端或正中'),
    step: z.number().optional().describe('步长，默认 1'),
    unit: z.string().optional().describe('单位，如「人」「%」'),
    labels: z.array(z.string()).optional().describe('两端的说明，如 ["大幅下降", "大幅上升"]'),
  }))
  const Sorter = def('Sorter', '配对分拣：把几样东西分进两三个类别（每样只进一类）。适合判别题、对比辨析中一次判断多个例子。', z.object({
    prompt: z.string().describe('如「下面这些，哪些是 A、哪些是 B？」'),
    bins: z.array(z.string()).describe('2～3 个类别名'),
    items: z.array(z.string()).describe('3～6 个待分的例子，顺序打乱，不要按类别排'),
  }))
  const Rewrite = def('Rewrite', '改写气泡：给出一段说法（教材原话或别人的话），学习者用自己的话重写。适合换个说法（rephrase）。', z.object({
    prompt: z.string().describe('如「如果要讲给你奶奶听，你会怎么说？」'),
    original: z.string().describe('要改写的原话'),
    placeholder: z.string().optional().describe('输入框提示，不能暗示答案'),
  }))
  const Examples = def('Examples', '举例工坊：几个空位，学习者各填一个自己想的例子（如一个正例、一个反例）。适合 own-examples 题。', z.object({
    prompt: z.string().describe('如「各举一个你生活中的例子」'),
    slots: z.array(z.string()).describe('1～3 个空位的名字，如 ["是 A 的例子", "看着像 A 其实不是"]'),
  }))
  const SpotError = def('SpotError', '找茬修复：点出一处有错的行，再用自己的话修正。不给正确答案。', z.object({
    prompt: z.string().describe('指出问题并修正的任务'),
    lines: z.array(z.string()).describe('至少 2 行代码或说法，恰有一处关键错误；不标注错误位置'),
    placeholder: z.string().optional().describe('修正输入提示，不暗示答案'),
  }))
  const OrderSteps = def('OrderSteps', '步骤排序：依次点选全部候选，各用一次，排满才能提交，可撤销和重置；不支持干扰项或只选部分。', z.object({
    prompt: z.string().describe('明确排序目标，例如按请求实际经过的顺序'),
    items: z.array(z.string()).describe('通常 3～5 个先后明确、互不重复的事件，打乱后呈现，不携带正确顺序'),
  }))
  const Counterexample = def('Counterexample', '反例侦探：给一个说法和几条候选案例，学习者选出一条能推翻该说法的案例，并说明它缺了哪个必要条件。组件本身已收集理由，不要再加 Reason；不标对错。', z.object({
    prompt: z.string().describe('要学习者做什么，如「哪个案例能推翻这句话？」'),
    claim: z.string().describe('待检验的说法，不标注真假'),
    cases: z.array(z.string()).describe('至少 2 条候选案例，顺序不要暗示答案'),
    placeholder: z.string().optional().describe('理由输入提示，不能暗示答案'),
  }))
  const MinimalChange = def('MinimalChange', '最小改动：给目标和几条原条件，学习者只改其中一条并写出改法，同时说明理由；其余条件原样展示。组件本身已收集理由，不要再加 Reason；不做自动语义判分。', z.object({
    prompt: z.string().describe('要学习者做什么，如「只改一条，怎么改才能达到目标？」'),
    goal: z.string().describe('要达成的目标'),
    conditions: z.array(z.string()).describe('至少 2 条原条件，顺序不暗示答案'),
    placeholder: z.string().optional().describe('改法输入提示，不能暗示答案'),
  }))
  const DualPredict = def('DualPredict', '双局预测：给出只改变一个因素的前后两局和同一组选项，学习者分别预测两局的结果，并说明理由。组件本身已收集理由，不要再加 Reason；不标对错。', z.object({
    prompt: z.string().describe('要学习者分别预测什么'),
    before: z.string().describe('变化前的那一局情境'),
    after: z.string().describe('变化后的那一局情境；与 before 只差一个因素'),
    options: z.array(z.string()).describe('至少 2 个两局共用的选项，不标对错'),
  }))
  const TransferTask = def('TransferTask', '迁移任务：一个全新领域的情境、目标与可选约束，学习者写出实际方案，并说明学过的规律为什么在这里适用（不是把名词换掉）。组件本身已收集理由，不要再加 Reason。', z.object({
    prompt: z.string().describe('要学习者做什么，如「这个新领域该怎么决策？」'),
    situation: z.string().describe('新领域的具体情境，不能只是原例的名词替换'),
    goal: z.string().describe('要在这个情境里达成的实际目标'),
    constraints: z.array(z.string()).optional().describe('可选的实际约束，每项一句话'),
  }))
  const Boss = def('Boss', 'Boss 关：迁移题的情境卡，一个和学过的例子表面完全不同的新领域难题。用在 transfer 题里代替 Scene。', z.object({
    title: z.string().describe('Boss 的名字，如「医院急诊室的排班」'),
    text: z.string().describe('情境正文，2～4 句；背景与条件分段、多个条件用换行 - 列表，少量 **重点** 或 `术语`，不标答案'),
  }))
  const Quiz = def(ROOT, '一道互动题，整张卡片。body 从上到下排列；学习者答完所有作答组件后点「提交作答」。', z.object({
    title: z.string().describe('一句话标题，像关卡名，如「咖啡店的排队难题」'),
    type: z.enum(QUESTION_TYPES).describe('题型'),
    body: z.array(z.union([Scene.ref, Boss.ref, Pick.ref, Choice.ref, Slider.ref, Sorter.ref, Rewrite.ref, Examples.ref, SpotError.ref, OrderSteps.ref, Counterexample.ref, MinimalChange.ref, DualPredict.ref, TransferTask.ref, Reason.ref])).describe('内容块，通常是 Scene（或 Boss）→ 一个作答组件；组件本身收集理由时不必再加 Reason'),
    level: z.number().int().min(1).max(5).optional().describe('难度 1～5，填导师要求的【难度】'),
  }))

  return createLibrary({
    root: ROOT,
    components: [Quiz, Scene, Boss, Pick, Card, Choice, Slider, Sorter, Rewrite, Examples, SpotError, OrderSteps, Counterexample, MinimalChange, DualPredict, TransferTask, Reason],
    componentGroups: [
      { name: '结构', components: [ROOT, 'Scene', 'Boss'] },
      { name: '作答', components: ['Pick', 'Card', 'Choice', 'Slider', 'Sorter', 'Rewrite', 'Examples', 'SpotError', 'OrderSteps', 'Counterexample', 'MinimalChange', 'DualPredict', 'TransferTask', 'Reason'] },
    ],
  })
}

/** A parser for quiz programs, validating against the library's props schemas. */
export function quizParser(library = quizLibrary()) {
  return createParser(library.toJSONSchema(), ROOT)
}
