// An anonymized regression of the camera course's repeated diagnosis loop.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

export const RECOVERY_SCENARIO = {
  id: 'prerequisite-recovery/camera', recovery: true, defect: 'missing-prereq',
  expect: { expect: ['missing-prereq'], prescriptionKeywords: ['基础', '前置'] },
  course: {
    goal: '搭建多相机采集系统', background: '会编程，但相机、视觉几何和硬件是新领域',
    kp: { id: 'system-map', title: '系统概览与故障归层', kind: 'knowledge' },
    models: [{ id: 'route', type: 'discriminative', concept: '采集故障所属的系统层次',
      reference: '区分接入、同步、标定、编码、写盘环节；深入判别需要理解对应环节的原理。' }],
    basics: [
      { id: 'imaging', title: '相机成像基础', kind: 'knowledge' },
      { id: 'bandwidth', title: '带宽与采集负载', kind: 'knowledge' },
    ],
  },
  statement: '先看单路视频，再看多路时间和空间关系。',
  opening: '之前我说过「先看单路视频，再看多路时间和空间关系。」但我连标定是什么都不知道，曝光也模模糊糊，后来又问了三角化是什么。你简单解释后，又让我做了好几道减路数、单路正常的题，每次都让我补一句判据。我有点串不起来了，为什么一直反反复复学这一个东西，对应基础还没讲？',
  followup: '好，先从缺的基础开始讲，原来的进度保留，基础学完再回来。',
  persona: '初学者，缺相机领域基础，希望先学习必要概念。',
}

export function scoreRecovery(ws, events, history) {
  const course = JSON.parse(readFileSync(join(ws, '.learn/course.json'), 'utf8'))
  const ids = course.chapters.flatMap((ch) => ch.kpIds)
  const original = JSON.parse(readFileSync(join(ws, '.learn/kp/system-map.json'), 'utf8'))
  const calls = events.filter((e) => e.type === 'tool/call').map((e) => ({ name: e.data.name,
    args: typeof e.data.arguments === 'string' ? JSON.parse(e.data.arguments) : e.data.arguments }))
  const failures = []
  if (ids.indexOf('system-map') < 1) failures.push('没有把基础排到原任务之前')
  if (!RECOVERY_SCENARIO.course.basics.every((kp) => ids.includes(kp.id))) failures.push('已有基础点丢失')
  const model = original.models.find((m) => m.id === 'route')
  if (model?.targetMap.statement?.text !== RECOVERY_SCENARIO.statement || model?.mastery !== 'none' || model?.phase === 'mastered') failures.push('原学习证据或掌握度被改写')
  if (calls.some((c) => ['verification_record', 'examiner', 'quiz_show'].includes(c.name))) failures.push('求助期间仍在判题或继续出题')
  return { passed: !failures.length, failures, ids, calls: calls.map((c) => c.name),
    // Teaching semantics require human review of the actual reply, beyond route/store gates.
    teachingReview: 'required', replies: history.filter((m) => m.who === 'tutor').map((m) => m.text) }
}
