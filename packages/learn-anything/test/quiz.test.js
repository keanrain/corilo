// Interactive quizzes: the shared library, the examiner's language section and quiz_show.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { quizLibrary } from '../src/quiz/library.js'
import { checkQuiz, quizLanguageSection, quizShowTool, quizText } from '../src/host/quiz.js'
import { parseView } from '../src/host/render.js'

const QUIZ = `root = Quiz("周五晚上的咖啡店", "discriminate-neg", [scene, pick, why])
scene = Scene("小林要不要多开一小时？", "店长小林")
pick = Pick("哪一笔不是边际成本？", [Card("加班费"), Card("房租", "每月 1 号付清"), Card("电费")])
why = Reason("为什么？")`

test('a well-formed quiz passes; broken ones say what is wrong', () => {
  assert.deepEqual(checkQuiz(QUIZ), [])
  assert.match(checkQuiz(QUIZ.replace(', why]', ', why, extra]')).join(), /extra/)
  assert.match(checkQuiz('root = Scene("x")').join(), /root 必须是 Quiz/)
  assert.match(checkQuiz(QUIZ.replace('"discriminate-neg"', '"riddle"')).join(), /type/)
  assert.match(checkQuiz('root = Quiz("x", "scenario", [Choice("q", ["a"').join(), /不完整|Quiz/)
})

test('each question type has a component that fits it', () => {
  const quizzes = {
    predict: `root = Quiz("涨价之后", "predict", [Scene("奶茶涨价两元。"), Slider("销量会变成原来的几成？", 0, 150, 10, "%", ["少很多", "多很多"]), Reason("为什么？")])`,
    contrast: `root = Quiz("分一分", "contrast", [Sorter("哪些是固定成本？", ["固定成本", "变动成本"], ["房租", "豆子", "电费"])])`,
    rephrase: `root = Quiz("讲给奶奶听", "rephrase", [Rewrite("换成大白话", "边际成本是多生产一单位的成本")])`,
    'own-examples': `root = Quiz("你的例子", "own-examples", [Examples("各举一个", ["是边际成本", "看着像其实不是"])])`,
    transfer: `root = Quiz("急诊室", "transfer", [Boss("急诊室的夜班", "要不要多排一名夜班医生？"), Reason("怎么判断？")])`,
  }
  for (const [type, ui] of Object.entries(quizzes)) assert.deepEqual(checkQuiz(ui), [], type)
  assert.match(quizText(quizzes.predict), /0～150% 之间估一个数/)
  assert.match(quizText(quizzes.contrast), /固定成本 \/ 变动成本[\s\S]*- 豆子/)
  assert.match(checkQuiz(quizzes.contrast.replace('["房租", "豆子", "电费"]', '')).join(), /items|Sorter/)
})

test('no component shadows an OpenUI builtin (Sort, Count, …), which the parser would resolve instead', () => {
  const builtins = ['Count', 'First', 'Last', 'Sum', 'Avg', 'Min', 'Max', 'Sort', 'Filter']
  for (const name of Object.keys(quizLibrary().toJSONSchema().$defs)) assert.ok(!builtins.includes(name), name)
})

test('no component can mark the right answer', () => {
  const { $defs } = quizLibrary().toJSONSchema()
  for (const [name, def] of Object.entries($defs)) {
    for (const prop of Object.keys(def.properties ?? {})) {
      assert.doesNotMatch(prop, /answer|correct|right|solution/i, `${name}.${prop}`)
    }
  }
})

test('the examiner section lists the components and the no-answer rule', () => {
  const text = quizLanguageSection()
  for (const name of ['Quiz(', 'Scene(', 'Boss(', 'Pick(', 'Card(', 'Choice(', 'Slider(', 'Sorter(', 'Rewrite(', 'Examples(', 'Reason(']) assert.ok(text.includes(name), name)
  assert.match(text, /【互动】/)
  assert.match(text, /标准答案/)
  // The example in the section is itself a valid quiz.
  const example = /root = Quiz[\s\S]*?(?=\n\n|\n#|$)/.exec(text.slice(text.indexOf('## Examples')))
  assert.ok(example, 'has an example')
  assert.deepEqual(checkQuiz(example[0]), [])
})

test('quiz_show returns a quiz view, unwrapping a copied code fence', async () => {
  const text = await quizShowTool.execute({ ui: '```openui-lang\n' + QUIZ + '\n```', question: '房租算不算？' })
  const view = parseView(text)
  assert.equal(view.view, 'quiz')
  assert.match(view.id, /^q-/)
  assert.equal(view.ui, QUIZ)
  assert.equal(view.question, '房租算不算？')
  assert.equal(view.helpDemo, undefined)
  assert.match(text, /【作答】/)
})

test('quiz_show only attaches a known demo when explicitly selected', async () => {
  const view = parseView(await quizShowTool.execute({ ui: QUIZ, question: '原题', helpDemo: 'execution-waiting' }))
  assert.equal(view.helpDemo, 'execution-waiting')
  await assert.rejects(quizShowTool.execute({ ui: QUIZ, question: '原题', helpDemo: 'unknown' }), /Unknown helpDemo/)
})

test('practice cards carry their purpose while verification remains the default', async () => {
  const practice = await quizShowTool.execute({ ui: QUIZ, question: '比较这组案例', purpose: 'practice' })
  assert.equal(parseView(practice).purpose, 'practice')
  assert.match(practice, /理解练习[\s\S]*不调用 verification_record/)
  assert.equal(parseView(await quizShowTool.execute({ ui: QUIZ.replace(/^root = /, ''), question: '比较这组案例', purpose: 'practice' })).ui, QUIZ)
  assert.equal(parseView(await quizShowTool.execute({ ui: QUIZ, question: '新情况' })).purpose, undefined)
  await assert.rejects(quizShowTool.execute({ ui: QUIZ, question: 'q', purpose: 'unknown' }), /Unknown quiz purpose/)
  await assert.rejects(quizShowTool.execute({ ui: QUIZ, question: 'q', purpose: 'practice', retryOf: 'v-old' }), /理解练习不关联/)
})

test('quizText lays a quiz out as plain text', () => {
  assert.equal(quizText(QUIZ), '【周五晚上的咖啡店】\n（店长小林）小林要不要多开一小时？\n哪一笔不是边际成本？\n  A. 加班费\n  B. 房租（每月 1 号付清）\n  C. 电费\n为什么？')
  assert.equal(quizText('hello'), null)
})

test('quiz_show rejects an invalid quiz so the tutor falls back to text', async () => {
  await assert.rejects(quizShowTool.execute({ ui: 'hello', question: 'q' }), /无法显示[\s\S]*文字/)
})

test('a quiz may carry its difficulty, shown in the plain-text layout', () => {
  const ui = 'root = Quiz("小测", "scenario", [s, c], 3)\ns = Scene("一个情境")\nc = Choice("选哪个？", ["甲", "乙"])'
  assert.deepEqual(checkQuiz(ui), [])
  assert.match(quizText(ui), /^【小测】（难度 3\/5）/)
})

test('quiz_show rejects parsed programs whose fields cannot collect distinct answers', async () => {
  const cases = [
    ['[]', /作答组件/],
    ['[Scene("只讲情境")] ', /作答组件/],
    ['[Choice("判断", ["是", "否"]), Reason("判断")]', /prompt 重复/],
    ['[Choice("判断", ["是", "否"]), Reason(" 判断 ")]', /prompt 重复/],
    ['[Reason(" ")]', /prompt 不能为空/],
    ['[Choice("选哪项", [])]', /Choice.options/],
    ['[Choice("选哪项", ["甲", " "])]', /Choice.options/],
    ['[Pick("选哪张", [])]', /Pick.cards/],
    ['[Pick("选哪张", [Card(" ")])]', /Pick.cards/],
    ['[Sorter("分一分", [], ["甲"])]', /Sorter.bins/],
    ['[Sorter("分一分", ["甲类", " "], ["甲"])]', /Sorter.bins/],
    ['[Sorter("分一分", ["甲类"], [])]', /Sorter.items/],
    ['[Sorter("分一分", ["甲类"], [" "])]', /Sorter.items/],
    ['[Examples("举例", [])]', /Examples.slots/],
    ['[Examples("举例", [" "])]', /Examples.slots/],
    ['[Rewrite("换个说法", " ")]', /Rewrite.original/],
    ['[Slider("估计", 10, 0)]', /min < max/],
    ['[Slider("估计", 10, 10)]', /min < max/],
    ['[Slider("估计", 0, 1e309)]', /min < max/],
    ['[Slider("估计", 0, 10, 0)]', /step/],
    ['[Slider("估计", 0, 10, -1)]', /step/],
    ['[Slider("估计", 0, 10, 1e309)]', /step/],
  ]
  for (const [body, expected] of cases) {
    const ui = `root = Quiz("小测", "scenario", ${body})`
    assert.match(checkQuiz(ui).join('；'), expected, body)
    await assert.rejects(quizShowTool.execute({ ui, question: '文字版题目' }), /无法显示[\s\S]*文字/, body)
  }
  assert.match(checkQuiz('root = Quiz(" ", "recall", [Reason("回忆一下")])').join(), /title/)
})

test('answerability checks preserve free-text questions, defaults and fractional slider steps', () => {
  for (const body of [
    '[Reason("怎么判断？")]',
    '[Slider("估计", -5, 0)]',
    '[Slider("估计", 0, 1, 0.1), Reason("为什么？")]',
    '[Examples("举例", ["一个正例"])]',
  ]) assert.deepEqual(checkQuiz(`root = Quiz("小测", "recall", ${body})`), [], body)
})

test('spot repair and ordered steps validate usable inputs and preserve numbered text fallback', () => {
  const spot = 'root = Quiz("修复", "contrast", [SpotError("指出错误并修正", ["先校验", "跳过权限", "保存"])])'
  const order = 'root = Quiz("旅程", "scenario", [OrderSteps("按时间排序", ["响应", "请求", "处理"])])'
  for (const ui of [spot, order]) assert.deepEqual(checkQuiz(ui), [])
  assert.match(quizText(spot), /指出行号并写出修正[\s\S]*2\. 跳过权限/)
  assert.match(quizText(order), /按顺序写出步骤编号[\s\S]*1\. 响应/)
  for (const body of [
    'SpotError("修正", [])', 'SpotError("修正", ["只有一行"])', 'SpotError("修正", ["甲", " "])',
    'OrderSteps("排序", [])', 'OrderSteps("排序", ["甲"])', 'OrderSteps("排序", ["甲", " "])', 'OrderSteps("排序", ["甲", " 甲 "])',
  ]) assert.ok(checkQuiz(`root = Quiz("测试", "scenario", [${body}])`).length, body)
  assert.match(quizLanguageSection(), /SpotError/)
  assert.match(quizLanguageSection(), /OrderSteps/)
})
