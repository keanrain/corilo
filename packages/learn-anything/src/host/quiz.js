/**
 * Interactive exercises: the tutor arranges reviewed teaching cases, or the examiner writes a verification question in OpenUI Lang
 * (its 【互动】 block, guided by the language section below), the tutor passes it to
 * `quiz_show`, and the Web half draws it in the learning sidebar. The learner's
 * answer comes back as an ordinary message starting with 「【作答】」, so grading
 * follows the same examine flow as a typed answer. Clients without the card see the
 * plain question that rides along as the fallback.
 */
import { randomBytes } from 'node:crypto'
import { quizLibrary } from '../quiz/library.js'
import { checkQuiz } from '../quiz/program.js'
export { checkQuiz, quizText } from '../quiz/program.js'
import { marker } from './render.js'
import { validateSources } from './ingest.js'
import { loadRetry, sameQuestion } from './retry.js'
import { HELP_PREFIX } from '../quiz/answer.js'
export { HELP_PREFIX }

export const ANSWER_PREFIX = '【作答】'
/** Messages the card's control row sends besides an answer: ask for a hint, change the pace, take a break. */
export const HINT_PREFIX = '【求提示】'
export const PACE_PREFIX = '【换题】'
export const BREAK_PREFIX = '【歇一会儿】'

const library = quizLibrary()

const EXAMPLE = `root = Quiz("周五晚上的咖啡店", "discriminate-neg", [scene, pick, why], 3)
scene = Scene("小林的咖啡店周五晚上要不要多留一个店员到 11 点？他列了几笔账。", "店长小林")
pick = Pick("哪一笔不该算进「多开这一小时」的边际成本？", [Card("店员加班费"), Card("多用的电费"), Card("这个月的房租", "每月 1 号付清"), Card("多卖出的咖啡用掉的豆子")])
why = Reason("为什么？说说你的判断依据", "从「多开一小时会不会让这笔钱变化」想起")`

/** System-prompt section for the examiner: how to write the 【互动】 block. */
export function quizLanguageSection() {
  return `## 互动题（【互动】）\n\n${library.prompt({
    preamble: '出题时，除了【题目】，再把同一道题写成一张互动卡片，放在【互动】后面的 ```openui-lang 代码块里。卡片用 openui-lang 写，下面是它的语法和可用组件。',
    additionalRules: [
      '卡片和【题目】问的是同一件事；【题目】是卡片显示不了时的文字版。',
      'Quiz 的第四个参数 level 填这道题的难度（1～5，和【难度】一致）。',
      '绝不能在卡片里出现标准答案、判分要点或暗示答案的措辞：选项不标对错，placeholder 不提示结论，Card 的顺序不要暗示答案。',
      '用 Scene 把情境讲生动（具体的人、地点、数字），但不要写进题目以外的提示；已有完整情境的作答组件无需重复 Scene，transfer 可用 TransferTask，或 Boss 配合原有作答组件。',
      '题干按背景、已知条件分短段；多个条件在字符串里用换行和 - 列表，不堆成长段。可用 **重点** 或 `术语` 突出少量已知数量、限制和名词；所有候选采用一致格式，不借加粗暗示答案。核心问题放作答组件的 prompt，不重复整段情境。',
      '按题型选作答组件：判别题、对比辨析用 Pick（找冒牌货）或 Sorter（一次分拣多个例子）；预测题结果是数量时用 Slider，否则用 Choice；判断题用 Choice；rephrase 用 Rewrite；own-examples 用 Examples。',
      'Slider 的区间要让正确答案落在中间某处，不要正好在两端或正中；Sorter 的例子顺序打乱。',
      '找错误并改正用 SpotError：lines 至少两行，恰有一处关键错误，不标记位置；按流程推演用 OrderSteps：items 至少两项、互不重复且打乱，不附正确顺序。',
      '一张卡片只问一件事：最多一个主要作答组件，再加一个 Reason 让学习者说出依据；Rewrite、Examples 可省 Reason；Counterexample、MinimalChange、DualPredict、TransferTask 已内含理由，不再追加 Reason。',
      'Counterexample 用新案例检验说法边界；MinimalChange 只改一个给定条件并解释；DualPredict 的前后情境只改变一个因素；TransferTask 把同一规律用于实质不同的新领域，提供必要背景及约束。它们是作答形式，Quiz.type 仍用原有题型，不因选中或提交就认定掌握。',
      '每个作答组件的 prompt 必须非空且互不相同；选项、候选卡片、分拣类别和项目、举例槽位都不能为空。Slider 必须 min < max，step 为正数。',
    ],
    examples: [EXAMPLE,
      'root = Quiz("修复一条规则", "contrast", [SpotError("点出错误行并修正", ["先读取请求参数", "不校验就直接写入数据库", "返回处理结果"])])',
      'root = Quiz("请求的旅程", "scenario", [OrderSteps("按请求处理的先后顺序排列", ["返回响应", "接收请求", "处理业务"])])',
    ],
  })}`
}

/** Normalize a copied fence or a bare Quiz expression before the usual validation. */
function unfence(ui) {
  const m = /```[\w-]*\n([\s\S]*?)```/.exec(ui)
  const program = (m ? m[1] : ui).trim()
  return /^Quiz\s*\(/.test(program) ? `root = ${program}` : program
}

export const quizShowTool = {
  name: 'quiz_show',
  description: 'Show an interactive card in the learning sidebar. For formal verification (default), pass the examiner\'s 【互动】 openui-lang as ui and 【题目】 as question. In assess/build, use purpose="practice" for concrete case judgments and comparisons; arrange already-checked material directly, e.g. root = Quiz("对照观察", "contrast", [Scene("完整案例和条件"), Choice("要判断的问题", ["结论甲", "结论乙"]), Reason("你依据哪条观察？")]). Replace the example text with the actual case. A practice answer is for coaching, not verification_record. Keep short clarifications and the learner\'s own full rule in ordinary chat. For a formal mistake retry, pass the original verification id as retryOf now. Never include the standard answer. Wait for the card\'s 【作答】 after success; on error show the full text question.',
  parameters: {
    ui: { type: 'string', required: true, description: '以 root = Quiz(...) 开头；正式验证原样传考官【互动】，理解练习可编排已核对案例。题干按背景、已知条件分短段，条件用换行 - 列表；支持少量 **重点** 和 `术语`，所有候选格式一致，不暗示答案' },
    question: { type: 'string', required: true, description: '完整文字题面：正式验证沿用考官【题目】，理解练习写全案例、条件和问题' },
    purpose: { type: 'string', enum: ['practice', 'verify'], description: 'practice：讲解、诊断或归纳阶段的案例理解练习，提交后反馈和追问，不记掌握度；verify：正式验证（默认），按 examine 判题记录' },
    helpDemo: { type: 'string', enum: ['execution-waiting'], description: '仅当本题需要分清执行和等待时选 execution-waiting，在“没看懂”里挂载可操作补给。演示预设等待区有空位，不模拟扩容、拒绝或直接交接。其他题省略' },
    retryOf: { type: 'string', description: '错题重赛时传原 verification_record 的 id；只可重赛当前课程的 wrong/partial 记录' },
    sources: { type: 'array', items: { type: 'string' }, description: '只传实际来源字段中的教材块 id（materialId#n）或已核对的 URL；无来源时省略，例子 id 不能当教材块 id，不含标准答案或原文' },
  },
  async execute(args, exec) {
    const purpose = args.purpose ?? 'verify'
    if (!['practice', 'verify'].includes(purpose)) throw new Error('Unknown quiz purpose')
    if (purpose === 'practice' && args.retryOf) throw new Error('理解练习不关联正式重赛记录；补救后另出新的验证题再重赛')
    const ui = unfence(String(args.ui ?? ''))
    const problems = checkQuiz(ui)
    if (problems.length) throw new Error(`互动题无法显示：${problems.join('；')}。请改用文字把【题目】发给学习者。`)
    const cwd = exec?.agent?.session?.header.cwd ?? process.cwd()
    const retry = args.retryOf ? await loadRetry(cwd, args.retryOf) : undefined
    const question = String(args.question ?? '').trim()
    if (retry && sameQuestion(question, retry.question)) throw new Error('A retry must use a new situation or question, rather than repeat the original question')
    const sources = await validateSources(cwd, args.sources)
    const id = `q-${Date.now().toString(36)}${randomBytes(3).toString('hex')}`
    if (args.helpDemo !== undefined && args.helpDemo !== 'execution-waiting') throw new Error('Unknown helpDemo')
    const followup = purpose === 'practice'
      ? '本题是理解练习：收到作答后围绕观察依据反馈或追问，继续原来的讲解或归纳；不调用 verification_record，不自动转入正式验证。'
      : '收到作答后按 examine 直接调用 verification_record，由宿主核验并独立判题记录，无需另调 examiner 判题。'
    return `已向学习者展示互动题 ${id}。学习者在卡片里作答后，会发来以「${ANSWER_PREFIX}」开头的消息；现在结束本轮，不要再重复题目。${followup}
卡片上还有控制按钮：「${HINT_PREFIX}」要一级提示（题还开着），「${HELP_PREFIX}」请求补必要概念或起步例子（按 diagnose 的“先补地基”，保留原题，不判题、不重出题），「${PACE_PREFIX}」嫌太简单或太难、要换一道，「${BREAK_PREFIX}」想停下来。

${marker({ view: 'quiz', id, ui, question, sources, ...(purpose === 'practice' ? { purpose } : {}), ...(args.helpDemo ? { helpDemo: args.helpDemo } : {}), ...(retry ? { retry: { id: retry.id, question: retry.question, answer: retry.answer, kpId: retry.kpId, modelId: retry.modelId, factId: retry.factId } } : {}) })}`
  },
}
