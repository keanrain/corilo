import { test } from 'node:test'
import assert from 'node:assert/strict'
import { assertUserWords, isRuleStatement } from '../src/host/assessment.js'

const check = (text, source = text) => assertUserWords(text, { userTexts: () => [source] })

test('learner rules preserve colons, parentheses, multiple sentences and rhetorical phrasing', () => {
  for (const text of ['判别标准：只要满足 X 就是 Y', '满足条件（包括边界）就是正例。', '难道只要满足共有属性，不就是这个概念吗？', '只要满足共有属性，不就是这个概念吗？', '输入增大，输出就增大。输入减小，输出也减小。']) {
    assert.equal(check(text), 'verified')
  }
  assert.equal(check('只要满足 X 就是 Y', '我的判别标准：只要满足 X 就是 Y。'), 'verified')
  assert.equal(check('函数记住了定义时的变量', '我觉得闭包就是：函数记住了定义时的变量。'), 'verified')
})

test('pure questions, help messages and invented summaries remain rejected', () => {
  for (const text of ['这个规律是什么？', '怎么理解这个概念？', '不知道参考规律是什么', '我不懂。参考规律满足条件就是正例。', '【学习补给】参考规律：条件满足就是正例', '[SCHEDULE REMINDER BATCH]\n参考规律满足条件']) {
    assert.equal(isRuleStatement(text), false)
    assert.throws(() => check('参考规律', text), /statement rejected/)
  }
  assert.throws(() => check('满足条件就是正例', '条件是什么？'), /statement rejected/)
  assert.throws(() => check('导师总结的规律', '我的原文不一样'), /statement rejected/)
  assert.throws(() => assertUserWords('满足条件就是正例', { userTexts: () => null }), /evidence unavailable/)
})

test('substring matching cannot remove negation or change mathematical operators', () => {
  for (const [statement, source] of [
    ['所有 X 都是 Y', '并非所有 X 都是 Y'],
    ['满足条件就是正例', '不是满足条件就是正例'],
    ['所有 X 都是 Y', '所有 X 都是 Y 这个说法是错误的'],
    ['x < 0 时输出为正', 'x > 0 时输出为正'],
    ['x > 0 时输出为正', 'X > 0 时输出为正'],
    ['x = 0 时输出为正', 'x != 0 时输出为正'],
    ['x ∈ A 时输出为正', 'x ∉ A 时输出为正'],
    ['isValid 时可以保存', '!isValid 时可以保存'],
    ['满足 X 就是 Y', '只有满足 X 就是 Y'],
    ['满足 X 就是 Y', '我觉得只有满足前置条件才是：满足 X 就是 Y'],
    ['满足 X 就是 Y', '我觉得并非这个概念就是：满足 X 就是 Y'],
    ['满足 X 就是 Y', '满足 X 就是 Y 仅在先决条件成立时有效'],
    ['所有 X 都是 Y', 'Not 所有 X 都是 Y'],
  ]) assert.throws(() => check(statement, source), /statement rejected/)
  assert.equal(check('只有 x > 0 时输出为正', '判别标准：只有 x > 0 时输出为正。'), 'verified')
  for (const source of ['只有满足 X 才是 Y', 'x != 0 时输出为正', '!isValid 时禁止保存']) assert.equal(check(source), 'verified')
})
