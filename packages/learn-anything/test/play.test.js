// The four play answer forms: component schemas, program validation/fallback, and
// the pure completeness/text helpers. These tests never assert semantic correctness.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ANSWER_COMPONENTS, QUESTION_TYPES, quizLibrary } from '../src/quiz/library.js'
import { checkQuiz, quizText } from '../src/quiz/program.js'
import { playAnswerComplete, playAnswerText } from '../src/quiz/play.js'

const PLAYS = ['Counterexample', 'MinimalChange', 'DualPredict', 'TransferTask']

const PROGRAMS = {
  Counterexample: 'root = Quiz("企鹅是不是鸟", "discriminate-neg", [Counterexample("哪个案例能推翻这句话？", "所有鸟都会飞", ["企鹅不会飞", "麻雀会飞", "鸵鸟不会飞"], "说说它缺了哪个条件")])',
  MinimalChange: 'root = Quiz("只改一条", "scenario", [MinimalChange("只改一个条件，怎么达到目标？", "让队列不丢任务", ["队列满就拒绝", "消费者单线程", "失败不重试"], "写出新的条件")])',
  DualPredict: 'root = Quiz("线程数变了", "predict", [DualPredict("两局分别会怎样？", "线程数从 2 增到 4，队列长度不变", "线程数从 2 增到 4，队列长度也减半", ["吞吐上升", "吞吐不变", "吞吐下降"])])',
  TransferTask: 'root = Quiz("急诊分诊", "transfer", [TransferTask("这个新领域该怎么做？", "医院急诊室排队越来越长，只有两名医生", "在不增加医生的情况下缩短等待时间", ["不能加设备", "夜班必须有人"])])',
}

const OLD_QUIZ = `root = Quiz("周五晚上的咖啡店", "discriminate-neg", [scene, pick, why])
scene = Scene("小林要不要多开一小时？", "店长小林")
pick = Pick("哪一笔不是边际成本？", [Card("加班费"), Card("房租", "每月 1 号付清"), Card("电费")])
why = Reason("为什么？")`

const OLD_TEXT = '【周五晚上的咖啡店】\n（店长小林）小林要不要多开一小时？\n哪一笔不是边际成本？\n  A. 加班费\n  B. 房租（每月 1 号付清）\n  C. 电费\n为什么？'

test('the library exposes four play forms without adding question types or answer props', () => {
  const { $defs } = quizLibrary().toJSONSchema()
  for (const name of PLAYS) {
    assert.ok(ANSWER_COMPONENTS.includes(name), name)
    assert.ok($defs[name], name)
    for (const prop of Object.keys($defs[name].properties ?? {})) {
      assert.doesNotMatch(prop, /answer|correct|right|solution/i, `${name}.${prop}`)
    }
  }
  assert.deepEqual(QUESTION_TYPES, ['scenario', 'predict', 'discriminate-pos', 'discriminate-neg', 'contrast', 'rephrase', 'own-examples', 'transfer', 'recall'])
})

test('well-formed programs for the four play forms pass and are laid out as text', () => {
  for (const [name, ui] of Object.entries(PROGRAMS)) {
    assert.deepEqual(checkQuiz(ui), [], name)
    assert.ok(quizText(ui), name)
  }
  const text = {
    Counterexample: quizText(PROGRAMS.Counterexample),
    MinimalChange: quizText(PROGRAMS.MinimalChange),
    DualPredict: quizText(PROGRAMS.DualPredict),
    TransferTask: quizText(PROGRAMS.TransferTask),
  }
  assert.match(text.Counterexample, /说法：所有鸟都会飞[\s\S]*A\. 企鹅不会飞[\s\S]*C\. 鸵鸟不会飞[\s\S]*缺了哪个条件/)
  assert.match(text.MinimalChange, /目标：让队列不丢任务[\s\S]*其余保持原样[\s\S]*1\. 队列满就拒绝[\s\S]*3\. 失败不重试/)
  assert.match(text.MinimalChange, /写出替换后的条件，并说明为什么只改这一条就足够/)
  assert.match(text.DualPredict, /变化前：线程数从 2 增到 4[\s\S]*变化后：线程数从 2 增到 4[\s\S]*A\. 吞吐上升[\s\S]*C\. 吞吐下降/)
  assert.match(text.TransferTask, /情境：医院急诊室[\s\S]*目标：在不增加医生[\s\S]*约束：不能加设备；夜班必须有人[\s\S]*在这里适用/)
  assert.equal(quizText('hello'), null)
})

test('the four play forms reject missing, blank, duplicate and too-short fields', () => {
  const cases = [
    ['Counterexample("q", "", ["甲", "乙"])', /Counterexample\.claim/],
    ['Counterexample("q", "说法", ["甲"])', /Counterexample\.cases 至少需要 2 项/],
    ['Counterexample("q", "说法", ["甲", " "])', /Counterexample\.cases 至少需要 2 项/],
    ['Counterexample("q", "说法", ["甲", " 甲 "])', /Counterexample\.cases 不能重复/],
    ['MinimalChange("q", "", ["甲", "乙"])', /MinimalChange\.goal/],
    ['MinimalChange("q", "目标", [])', /MinimalChange\.conditions 至少需要 2 项/],
    ['MinimalChange("q", "目标", ["甲", " 甲 "])', /MinimalChange\.conditions 不能重复/],
    ['DualPredict("q", "", "后", ["甲", "乙"])', /DualPredict\.before/],
    ['DualPredict("q", "前", "", ["甲", "乙"])', /DualPredict\.after/],
    ['DualPredict("q", "同一局", " 同一局 ", ["甲", "乙"])', /before 和 after 必须不同/],
    ['DualPredict("q", "前", "后", ["甲"])', /DualPredict\.options 至少需要 2 项/],
    ['DualPredict("q", "前", "后", ["甲", " 甲 "])', /DualPredict\.options 不能重复/],
    ['TransferTask("q", "", "目标")', /TransferTask\.situation/],
    ['TransferTask("q", "情境", "")', /TransferTask\.goal/],
    ['TransferTask("q", "情境", "目标", ["", "约束"])', /TransferTask\.constraints/],
    ['TransferTask("q", "情境", "目标", ["约束", " 约束 "])', /TransferTask\.constraints 不能重复/],
    ['Counterexample(" ", "说法", ["甲", "乙"])', /Counterexample\.prompt 不能为空/],
  ]
  for (const [body, expected] of cases) {
    const problems = checkQuiz(`root = Quiz("测试", "scenario", [${body}])`)
    assert.match(problems.join('；'), expected, body)
  }
  // constraints is optional, and an empty constraints list means none.
  assert.deepEqual(checkQuiz('root = Quiz("测试", "transfer", [TransferTask("q", "情境", "目标")])'), [])
  assert.deepEqual(checkQuiz('root = Quiz("测试", "transfer", [TransferTask("q", "情境", "目标", [])])'), [])
})

test('structural validation is not semantic validation', () => {
  // None of these cases is a real counterexample, but the card is structurally answerable.
  const ui = 'root = Quiz("找反例", "discriminate-neg", [Counterexample("哪个能推翻？", "所有鸟都会飞", ["麻雀会飞", "燕子会飞"], "缺了什么条件？")])'
  assert.deepEqual(checkQuiz(ui), [])
  assert.equal(playAnswerComplete('Counterexample', { cases: ['麻雀会飞', '燕子会飞'] }, [0, '它们都会飞']), true)
  // An unchanged replacement is not judged automatically; only blank text is incomplete.
  assert.equal(playAnswerComplete('MinimalChange', { conditions: ['原条件', '另一个'] }, [0, '原条件', '没有改动']), true)
})

test('playAnswerComplete treats 0 as valid and rejects null, non-integers, out-of-range and blanks', () => {
  const props = {
    Counterexample: { cases: ['甲', '乙'] },
    MinimalChange: { conditions: ['条件一', '条件二'] },
    DualPredict: { options: ['降', '不变', '升'] },
    TransferTask: {},
  }
  assert.equal(playAnswerComplete('Counterexample', props.Counterexample, [0, '缺了关键条件']), true)
  assert.equal(playAnswerComplete('Counterexample', props.Counterexample, [1, '缺了关键条件']), true)
  assert.equal(playAnswerComplete('Counterexample', props.Counterexample, [null, '理由']), false)
  assert.equal(playAnswerComplete('Counterexample', props.Counterexample, [-1, '理由']), false)
  assert.equal(playAnswerComplete('Counterexample', props.Counterexample, [2, '理由']), false)
  assert.equal(playAnswerComplete('Counterexample', props.Counterexample, [0.5, '理由']), false)
  assert.equal(playAnswerComplete('Counterexample', props.Counterexample, ['0', '理由']), false)
  assert.equal(playAnswerComplete('Counterexample', props.Counterexample, [0, '  ']), false)
  assert.equal(playAnswerComplete('Counterexample', { cases: ['只有一条'] }, [0, '理由']), false)

  assert.equal(playAnswerComplete('MinimalChange', props.MinimalChange, [0, '新的条件一', '理由']), true)
  assert.equal(playAnswerComplete('MinimalChange', props.MinimalChange, [1, '新的条件二', '理由']), true)
  assert.equal(playAnswerComplete('MinimalChange', props.MinimalChange, [null, '新条件', '理由']), false)
  assert.equal(playAnswerComplete('MinimalChange', props.MinimalChange, [2, '新条件', '理由']), false)
  assert.equal(playAnswerComplete('MinimalChange', props.MinimalChange, [0, ' ', '理由']), false)
  assert.equal(playAnswerComplete('MinimalChange', props.MinimalChange, [0, '新条件', '']), false)
  assert.equal(playAnswerComplete('MinimalChange', { conditions: ['只有一条'] }, [0, '新条件', '理由']), false)

  assert.equal(playAnswerComplete('DualPredict', props.DualPredict, [0, 0, '两局一样']), true)
  assert.equal(playAnswerComplete('DualPredict', props.DualPredict, [0, 2, '理由']), true)
  assert.equal(playAnswerComplete('DualPredict', props.DualPredict, [null, 2, '理由']), false)
  assert.equal(playAnswerComplete('DualPredict', props.DualPredict, [0, null, '理由']), false)
  assert.equal(playAnswerComplete('DualPredict', props.DualPredict, [3, 0, '理由']), false)
  assert.equal(playAnswerComplete('DualPredict', props.DualPredict, [0, -1, '理由']), false)
  assert.equal(playAnswerComplete('DualPredict', props.DualPredict, [0, 1, '  ']), false)
  assert.equal(playAnswerComplete('DualPredict', { options: ['只有一个'] }, [0, 0, '理由']), false)

  assert.equal(playAnswerComplete('TransferTask', props.TransferTask, ['先分诊再排队', '瓶颈在分诊台']), true)
  assert.equal(playAnswerComplete('TransferTask', props.TransferTask, ['', '理由']), false)
  assert.equal(playAnswerComplete('TransferTask', props.TransferTask, ['方案', ' ']), false)
  assert.equal(playAnswerComplete('TransferTask', props.TransferTask, ['方案']), false)

  assert.equal(playAnswerComplete('Unknown', {}, [0, '理由']), false)
  assert.equal(playAnswerComplete('Counterexample', null, [0, '理由']), false)
  assert.equal(playAnswerComplete('Counterexample', props.Counterexample, null), false)
})

test('playAnswerText reads a complete answer and stays empty for anything incomplete', () => {
  const counter = playAnswerText('Counterexample', { cases: ['麻雀会飞', '企鹅不会飞'] }, [1, '它缺了飞行能力'])
  assert.match(counter, /企鹅不会飞/)
  assert.match(counter, /它缺了飞行能力/)

  const minimal = playAnswerText('MinimalChange', { conditions: ['队列满就拒绝', '消费者单线程'] }, [0, '队列满时等待', '不丢任务'])
  assert.match(minimal, /队列满就拒绝/)
  assert.match(minimal, /队列满时等待/)
  assert.match(minimal, /不丢任务/)

  const dual = playAnswerText('DualPredict', { options: ['降', '不变', '升'] }, [0, 2, '因为多了一个因素'])
  assert.match(dual, /变化前：降/)
  assert.match(dual, /变化后：升/)
  assert.match(dual, /因为多了一个因素/)

  const transfer = playAnswerText('TransferTask', {}, ['把分诊和排队拆开', '两者都在争同一批医生'])
  assert.match(transfer, /把分诊和排队拆开/)
  assert.match(transfer, /两者都在争同一批医生/)

  for (const [type, props, value] of [
    ['Counterexample', { cases: ['甲', '乙'] }, [2, '理由']],
    ['Counterexample', { cases: ['甲', '乙'] }, [0, '']],
    ['MinimalChange', { conditions: ['甲', '乙'] }, [null, '改法', '理由']],
    ['DualPredict', { options: ['甲', '乙'] }, [0, null, '理由']],
    ['TransferTask', {}, ['', '理由']],
    ['Unknown', {}, ['方案', '理由']],
  ]) assert.equal(playAnswerText(type, props, value), '', `${type} ${JSON.stringify(value)}`)
})

test('old quiz programs keep the exact plain-text fallback', () => {
  assert.deepEqual(checkQuiz(OLD_QUIZ), [])
  assert.equal(quizText(OLD_QUIZ), OLD_TEXT)
  // Existing components are still accepted and laid out as before.
  const newer = 'root = Quiz("修复", "contrast", [SpotError("指出错误并修正", ["先校验", "跳过权限"]), OrderSteps("按时间排序", ["响应", "请求", "处理"])])'
  assert.deepEqual(checkQuiz(newer), [])
  assert.match(quizText(newer), /指出行号并写出修正[\s\S]*1\. 先校验[\s\S]*按顺序写出步骤编号[\s\S]*2\. 请求/)
})
