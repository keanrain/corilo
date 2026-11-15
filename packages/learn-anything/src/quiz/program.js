/**
 * Parsing and plain-text fallbacks for quiz programs, shared by the Host and the
 * evaluation learner. This module only reads a program and its component props: it
 * validates that a card can be answered, never whether an answer is semantically
 * right. Standard answers stay with the examiner and never enter this module.
 */
import { ROOT, ANSWER_COMPONENTS, quizLibrary, quizParser } from './library.js'

const library = quizLibrary()
const parser = quizParser(library)

const nonblank = (text) => typeof text === 'string' && text.trim().length > 0

/**
 * Validate a quiz program; returns the problems, empty when it renders as a whole Quiz.
 * Passing this check only means the fields are structurally answerable.
 */
export function checkQuiz(ui) {
  const result = parser.parse(ui)
  const problems = result.meta.errors.filter((e) => e.severity !== 'warning').map((e) => `${e.statementId ?? e.component}: ${e.message}`)
  if (result.meta.incomplete) problems.push('程序不完整（被截断或括号、引号没闭合）')
  if (result.meta.unresolved.length) problems.push(`引用了未定义的名字：${result.meta.unresolved.join('、')}`)
  if (!result.root || result.root.typeName !== ROOT) problems.push(`root 必须是 ${ROOT}(...)`)
  if (problems.length) return problems

  // OpenUI's parser validates prop types, but not whether the rendered fields can be answered.
  const list = (values, name) => {
    if (!Array.isArray(values) || !values.length || !values.every(nonblank)) problems.push(`${name} 至少包含一项，且每项文字不能为空`)
  }
  // Candidate lists must be non-empty, distinct, and long enough to choose from.
  const candidates = (values, name, minimum) => {
    if (!Array.isArray(values) || values.length < minimum || !values.every(nonblank)) {
      problems.push(`${name} 至少需要 ${minimum} 项，且每项文字不能为空`)
      return
    }
    if (new Set(values.map((value) => value.trim())).size !== values.length) problems.push(`${name} 不能重复`)
  }
  const required = (value, name) => {
    if (!nonblank(value)) problems.push(`${name} 不能为空`)
  }

  const root = result.root.props
  if (!nonblank(root.title)) problems.push('Quiz.title 不能为空')
  const fields = (root.body ?? []).filter((node) => ANSWER_COMPONENTS.includes(node?.typeName))
  if (!fields.length) problems.push('Quiz.body 至少需要一个作答组件')
  const prompts = new Set()
  for (const { typeName, props: p } of fields) {
    if (!nonblank(p.prompt)) problems.push(`${typeName}.prompt 不能为空`)
    else if (prompts.has(p.prompt.trim())) problems.push(`作答 prompt 重复：${p.prompt}；请为每个作答组件使用不同的问题`)
    else prompts.add(p.prompt.trim())
    switch (typeName) {
      case 'SpotError':
      case 'OrderSteps': {
        const values = typeName === 'SpotError' ? p.lines : p.items
        const name = `${typeName}.${typeName === 'SpotError' ? 'lines' : 'items'}`
        list(values, name)
        if ((values?.length ?? 0) < 2) problems.push(`${name} 至少需要两项`)
        if (typeName === 'OrderSteps' && new Set(values?.map((v) => v.trim())).size !== values?.length) problems.push(`${name} 不能重复`)
        break
      }
      case 'Choice': list(p.options, 'Choice.options'); break
      case 'Pick': list(p.cards?.map((card) => card?.props?.title), 'Pick.cards'); break
      case 'Sorter': list(p.bins, 'Sorter.bins'); list(p.items, 'Sorter.items'); break
      case 'Examples': list(p.slots, 'Examples.slots'); break
      case 'Rewrite': if (!nonblank(p.original)) problems.push('Rewrite.original 不能为空'); break
      case 'Slider':
        if (!Number.isFinite(p.min) || !Number.isFinite(p.max) || p.min >= p.max) problems.push('Slider 需要有限的 min < max')
        if (p.step !== undefined && (!Number.isFinite(p.step) || p.step <= 0)) problems.push('Slider.step 必须是有限的正数')
        break
      case 'Counterexample':
        required(p.claim, 'Counterexample.claim')
        candidates(p.cases, 'Counterexample.cases', 2)
        break
      case 'MinimalChange':
        required(p.goal, 'MinimalChange.goal')
        candidates(p.conditions, 'MinimalChange.conditions', 2)
        break
      case 'DualPredict':
        required(p.before, 'DualPredict.before')
        required(p.after, 'DualPredict.after')
        if (nonblank(p.before) && nonblank(p.after) && p.before.trim() === p.after.trim()) problems.push('DualPredict.before 和 after 必须不同')
        candidates(p.options, 'DualPredict.options', 2)
        break
      case 'TransferTask':
        required(p.situation, 'TransferTask.situation')
        required(p.goal, 'TransferTask.goal')
        if (p.constraints !== undefined) {
          if (!Array.isArray(p.constraints) || !p.constraints.every(nonblank)) problems.push('TransferTask.constraints 每项文字不能为空')
          else if (new Set(p.constraints.map((value) => value.trim())).size !== p.constraints.length) problems.push('TransferTask.constraints 不能重复')
        }
        break
    }
  }
  return problems
}

const LETTERS = 'ABCDEFGHIJ'

/**
 * A quiz as plain text, the way the card lays it out (Scene, then each answer component with
 * its options). For readers without the card: the eval's simulated learner. Null when the
 * program does not parse into a Quiz.
 */
export function quizText(ui) {
  const root = parser.parse(ui).root
  if (root?.typeName !== ROOT) return null
  const props = (node) => node?.props ?? {}
  const lines = [`【${root.props.title}】${root.props.level ? `（难度 ${root.props.level}/5）` : ''}`]
  for (const node of root.props.body ?? []) {
    const p = props(node)
    switch (node?.typeName) {
      case 'Scene': lines.push(`${p.who ? `（${p.who}）` : ''}${p.text}`); break
      case 'Boss': lines.push(`BOSS · ${p.title}：${p.text}`); break
      case 'Pick': lines.push(`${p.prompt}${p.multi ? '（可多选）' : ''}`, ...(p.cards ?? []).map((c, i) => `  ${LETTERS[i]}. ${props(c).title}${props(c).detail ? `（${props(c).detail}）` : ''}`)); break
      case 'Choice': lines.push(`${p.prompt}${p.multi ? '（可多选）' : ''}`, ...(p.options ?? []).map((o, i) => `  ${LETTERS[i]}. ${o}`)); break
      case 'Slider': lines.push(`${p.prompt}（在 ${p.min}～${p.max}${p.unit ?? ''} 之间估一个数${p.labels?.length ? `；${p.labels.join(' ↔ ')}` : ''}）`); break
      case 'Sorter': lines.push(`${p.prompt}（把每一项分进：${(p.bins ?? []).join(' / ')}）`, ...(p.items ?? []).map((item) => `  - ${item}`)); break
      case 'Rewrite': lines.push(`${p.prompt}`, `  原话：“${p.original}”`); break
      case 'Examples': lines.push(`${p.prompt}（每空一个例子：${(p.slots ?? []).join(' / ')}）`); break
      case 'SpotError': lines.push(`${p.prompt}（指出行号并写出修正）`, ...(p.lines ?? []).map((line, i) => `  ${i + 1}. ${line}`)); break
      case 'OrderSteps': lines.push(`${p.prompt}（按顺序写出步骤编号）`, ...(p.items ?? []).map((item, i) => `  ${i + 1}. ${item}`)); break
      case 'Counterexample': lines.push(`${p.prompt}`, `  说法：${p.claim}`, ...(p.cases ?? []).map((item, i) => `  ${LETTERS[i]}. ${item}`), '  （选一个能推翻说法的案例，并说明它缺了哪个条件）'); break
      case 'MinimalChange': lines.push(`${p.prompt}`, `  目标：${p.goal}`, '  现有条件（只改其中一条，其余保持原样）：', ...(p.conditions ?? []).map((item, i) => `  ${i + 1}. ${item}`), '  （写出替换后的条件，并说明为什么只改这一条就足够）'); break
      case 'DualPredict': lines.push(`${p.prompt}`, `  变化前：${p.before}`, `  变化后：${p.after}`, '  （两局从同一组选项里各选一个，并说明理由）', ...(p.options ?? []).map((item, i) => `  ${LETTERS[i]}. ${item}`)); break
      case 'TransferTask':
        lines.push(`${p.prompt}`, `  情境：${p.situation}`, `  目标：${p.goal}`)
        if (p.constraints?.length) lines.push(`  约束：${p.constraints.join('；')}`)
        lines.push('  （写出你的方案，并说明原规律为什么在这里适用）')
        break
      case 'Reason': lines.push(p.prompt); break
    }
  }
  return lines.join('\n')
}
