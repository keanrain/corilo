/**
 * Teaching state machine, per model. Knowledge models run the five-step loop
 * (describe → assess → prescribe → build → verify); information goes through
 * memorize. Any phase may fall back to `describe` when the knowledge has to be split again.
 * @module learn-anything/phases
 */

export const KNOWLEDGE_PHASES = ['describe', 'assess', 'prescribe', 'build', 'verify', 'mastered']
export const INFORMATION_PHASES = ['describe', 'memorize', 'mastered']

const KNOWLEDGE_NEXT = {
  describe: ['assess'],
  assess: ['prescribe'],
  prescribe: ['build'],
  build: ['verify', 'prescribe'],
  verify: ['assess'],
  mastered: ['assess'],
}

const INFORMATION_NEXT = {
  describe: ['memorize'],
  memorize: ['mastered'],
  mastered: ['memorize'],
}

/** What the tutor may do in each phase; injected into status output so the model stays on track. */
export const PHASE_GUIDE = {
  describe: '① 描述知识：拆出输入概念、输出概念和映射规律，标注知识/信息，用 kp_define_models 保存。',
  assess: '② 评估学况：根据验证记录和对话判断坍缩类型、记言代学、前置缺失、偏好，用 diagnosis_record 记录（带证据）。第一个知识点用一张 quiz_show(purpose="practice") 理解练习题卡当探针，不做多轮问答。',
  prescribe: '③ 制定材料：按处方表生成 #d/#e/#t 材料，规律与例子对齐；新生成的例子先交给 checker 校验，再用 target_map_update 写入。',
  build: '④ 继承模型：请用户在知识靶图卡的「编辑靶图」里直接写下自己的解释（首选，避免逐字不符被拒）；也可在聊天里发普通消息。通过追问、反例和纠偏引导用户归纳。具体案例判断、对比用 quiz_show(purpose="practice")，不记掌握度；完整规律由用户另发普通消息表述，不代写。',
  verify: '⑤ 验证模型：先处理缺前置或同一缺口反复出现的证据（按 diagnose 重新检查任务）；适合继续验证时，把模型和已有例子按建议难度和题型交给 examiner 出新情况题，判题后用 verification_record 记录，答对继续。',
  memorize: '信息类：用闪卡、填空、原文复述记忆，用 verification_record（questionType=recall）记录。',
  mastered: '已达标：进入下一个模型或知识点；到期复习时回到验证。',
}

export function phasesFor(kind) {
  return kind === 'information' ? INFORMATION_PHASES : KNOWLEDGE_PHASES
}

/**
 * Validate one phase change.
 * @returns null when allowed, otherwise the reason it is not.
 */
export function transitionError(kind, from, to) {
  const all = phasesFor(kind)
  if (!all.includes(to)) return `unknown phase ${JSON.stringify(to)} for ${kind}; phases: ${all.join(', ')}`
  if (from === to) return null
  if (to === 'describe') return null
  if (to === 'mastered') return 'mastered is set automatically by verification_record when the mastery gate is met'
  const next = (kind === 'information' ? INFORMATION_NEXT : KNOWLEDGE_NEXT)[from] ?? []
  if (!next.includes(to)) return `cannot go from ${from} to ${to}; allowed: ${[...next, 'describe'].join(', ')}`
  return null
}

/** The phase a knowledge point is in: that of its first unmastered model. */
export function kpPhase(kp) {
  if (kp.kind === 'information') return kp.phase ?? 'describe'
  if (kp.models.length === 0) return 'describe'
  const open = kp.models.find((m) => m.phase !== 'mastered')
  return open ? open.phase : 'mastered'
}
