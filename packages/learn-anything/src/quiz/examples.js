/**
 * Standalone examples for the four play answer forms. Each entry is a complete `quiz`
 * view that any OpenUI Lang host with the same component library can render without
 * DSH: the play component already collects a reason, so there is no extra `Reason`,
 * and no field marks an answer.
 * The plain `question` mirrors the card's claim, candidates, conditions and options in
 * the same order, so readers without the card get the same complete question.
 */

const q = (text) => JSON.stringify(text)
const list = (items) => `[${items.map(q).join(', ')}]`
const quiz = (title, type, body) => `root = Quiz(${q(title)}, ${q(type)}, [${body}])`
const lettered = (items) => items.map((item, i) => `${'ABCDEFGHIJ'[i]}. ${item}`).join('\n')
const numbered = (items) => items.map((item, i) => `${i + 1}. ${item}`).join('\n')

const counterexampleClaim = '只要一个接口两次都返回 200，它就是幂等的。'

const counterexample = {
  context: '小林的团队正在给接口做一次幂等性复盘。他们翻出三条没见过的调用记录，想检验一句话是否站得住。',
  claim: counterexampleClaim,
  cases: [
    '对 GET /orders/42 连续请求两次，两次都返回 200，订单没有变化。',
    '对 POST /orders 连续提交两次相同内容，两次都返回 200，但各生成了一笔新订单。',
    '对 PUT /orders/42 连续提交两次相同内容，两次都返回 200，订单最终状态相同。',
  ],
}

const minimalChange = {
  context: '停车场的电子计价器按三个条件收费。',
  prompt: '三个条件只能改一个，其他保持原样。你会改哪一个？写出改后的条件，并说明为什么只改这一处就能同时满足这两个收费结果。',
  goal: '让停车 2 小时收 10 元、停 4 小时收 16 元。',
  conditions: [
    '超过 1 小时后，每小时 3 元，不足 1 小时按 1 小时计。',
    '起步价 5 元，包含前 1 小时。',
    '每天最高收费 30 元。',
  ],
}

const dualPredict = {
  before: '同一组 1000 个已从小到大排好序的整数，要找的数不在里面。用从头到尾逐个比较的线性查找，直到确认它不存在。',
  after: '同一组 1000 个已从小到大排好序的整数，要找的数不在里面。用每次把范围对半缩小的二分查找，直到确认它不存在。',
  options: [
    '大约 500 次比较',
    '大约 10 次比较',
    '大约 1000 次比较',
  ],
}

const transferTask = {
  rule: '你在面包店案例里学过：要不要多烤一炉，比的是多烤这一炉新增的收入和新增的成本；已经付掉的房租这类不随产量变化的固定成本，不算进这一炉的账。',
  prompt: '把这条规律用到下面的公交决策：写出你的方案（加开或不加开），并说明理由。',
  situation: '社区巴士的末班车现在 22:30 从地铁站发车。居民提议延长到 23:30，方便加班的人回家。线路、车辆和司机排班都保持现状，只讨论是否多开这一班。',
  goal: '在社区不提供额外补贴、只按本班票价收入计算的前提下，判断这一班的收入能否覆盖新增成本。',
  constraints: [
    '这一班预计有 18 名乘客，票价 2 元/人',
    '司机加班费 300 元，车辆电费 40 元',
    '车辆折旧、保险、线路审批费每月固定，不因多开一班变化',
  ],
}

export const PLAY_EXAMPLES = [
  {
    id: 'counterexample',
    title: '反例侦探',
    label: 'Counterexample',
    view: {
      view: 'quiz',
      id: 'play-counterexample',
      ui: quiz(
        '接口幂等性的边界',
        'discriminate-neg',
        `Scene(${q(counterexample.context)}, ${q('后端工程师小林')}), Counterexample(${q('哪一条调用记录能推翻这句话？并指出它漏掉了哪个条件，说说理由。')}, ${q(counterexample.claim)}, ${list(counterexample.cases)})`,
      ),
      question: `${counterexample.context}
他们检验的说法是：「${counterexample.claim}」
${lettered(counterexample.cases)}
哪一条调用记录能推翻这句话？并指出它漏掉了哪个条件，说说理由。`,
    },
  },
  {
    id: 'minimal-change',
    title: '最小改动',
    label: 'MinimalChange',
    view: {
      view: 'quiz',
      id: 'play-minimal-change',
      ui: quiz(
        '停车计价的改动',
        'scenario',
        `Scene(${q(minimalChange.context)}), MinimalChange(${q(minimalChange.prompt)}, ${q(minimalChange.goal)}, ${list(minimalChange.conditions)})`,
      ),
      question: `${minimalChange.context}
${numbered(minimalChange.conditions)}
现在要${minimalChange.goal}${minimalChange.prompt}`,
    },
  },
  {
    id: 'dual-predict',
    title: '双局预测',
    label: 'DualPredict',
    view: {
      view: 'quiz',
      id: 'play-dual-predict',
      ui: quiz(
        '有序数组里的查找',
        'predict',
        `DualPredict(${q('两场只有查找方法不同。分别预测每场大约比较多少次，并说明这个差别为什么会让结果不同。')}, ${q(dualPredict.before)}, ${q(dualPredict.after)}, ${list(dualPredict.options)})`,
      ),
      question: `变化前：${dualPredict.before}
变化后：${dualPredict.after}
两场只有查找方法不同。分别预测每场大约比较多少次，并说明这个差别为什么会让结果不同。两场共用下面三个选项：
${lettered(dualPredict.options)}`,
    },
  },
  {
    id: 'transfer',
    title: '迁移任务',
    label: 'TransferTask',
    view: {
      view: 'quiz',
      id: 'play-transfer',
      ui: quiz(
        '末班车要不要加开',
        'transfer',
        `Scene(${q(transferTask.rule)}), TransferTask(${q(transferTask.prompt)}, ${q(transferTask.situation)}, ${q(transferTask.goal)}, ${list(transferTask.constraints)})`,
      ),
      question: `${transferTask.rule}
${transferTask.prompt}
情境：${transferTask.situation}
目标：${transferTask.goal}
约束：
${numbered(transferTask.constraints)}`,
    },
  },
]
