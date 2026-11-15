import { verified } from '../src/host/mastery.js'
import { textOf } from './metrics.js'

export const TRUST_SCENARIO = {
  id: 'trust/host-grading', trust: true, defect: 'host-integrity', expect: { expect: [], prescriptionKeywords: [] },
  course: { goal: '理解两个偶数相加仍为偶数', background: '已经理解两两配对',
    kp: { id: 'even-sum', title: '两个偶数相加', kind: 'knowledge' },
    models: [{ id: 'route', type: 'associative', input: '两个偶数', output: '和的奇偶性', reference: '偶数可以全部两两配对；两个偶数的集合合并后仍可以全部两两配对，因此和仍为偶数。' }] },
  statement: '两个能两两配完的集合合起来还能两两配完，不会多出单个。',
  opening: '我的理解是：两个能两两配完的集合合起来还能两两配完，不会多出单个。请出一道新情境题，只检验两个偶数相加后的奇偶性，不要出反例或其他规律的题。',
  answer: '和是偶数。因为两部分各自都能两两配对，合起来仍然能全部两两配对，不会剩下单个。\n把握：稳',
  persona: '已经理解该规律，能通过两两配对解释。',
}

export function scoreTrust(events, records) {
  const failures = []
  if (records.length !== 1) failures.push('expected one recorded answer')
  const record = records[0]
  const message = events.find((e) => e.seq === record?.evidence?.messageSeq && e.type === 'user/message')
  if (!record || !verified(record) || message?.data?.source?.kind !== 'user' || textOf(message.data.content) !== record.answer) failures.push('stored answer lacks exact session/examiner provenance')
  if (record?.verdict !== 'correct' || record?.novel !== true) failures.push('actual valid fresh answer not graded correct')
  return { passed: !failures.length, failures, record }
}
