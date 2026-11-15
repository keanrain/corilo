// Knowledge-point definitions, phases, and learner-owned target maps.
import * as store from '../store.js'
import { transitionError, PHASE_GUIDE } from '../phases.js'
import { factsWithIds, factMasteries, LEVEL_LABEL } from '../mastery.js'
import { targetMapView } from '../render.js'
import { validateSources } from '../ingest.js'
import { isRuleStatement } from '../assessment.js'
import { str, strArray, gateOf, loadVerifications, saveKp, nextExampleId, refreshMastery, describeModel } from './shared.js'

const exampleSpec = {
  type: 'object',
  additionalProperties: false,
  properties: {
    tag: str('d 规述 / e 例述 / t 迁移(类比或对比) / v 验证题转来的例子', { enum: ['d', 'e', 't', 'v'], required: true }),
    polarity: str('正例 pos / 反例 neg；规述可省略', { enum: ['pos', 'neg'] }),
    input: str('具体输入或情境', { required: true }),
    output: str('对应输出或判别结论', { required: true }),
    reasoning: str('从输入推到输出的理由（规律如何落在这个例子上）'),
    origin: str('material 来自材料 / ai 由你生成 / user 用户自己举的', { enum: ['material', 'ai', 'user'], required: true }),
    checked: { type: 'boolean', description: '是否已经过 checker 校验；AI 生成的例子校验通过后才能为 true' },
    source: str('材料块 id 或 URL'),
  },
}

function normalize(text) {
  return text.toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '')
}

/** The 不代写 rule: a statement must be the learner's own words from this session. */
function assertUserWords(text, env) {
  const texts = env.userTexts?.()
  if (texts == null) throw new Error('learner message evidence unavailable; statement rejected')
  const needle = normalize(text)
  if (needle.length < 4) throw new Error('statement is too short to be a real statement of the rule')
  if (texts.filter(isRuleStatement).some((t) => t.split(/[。！!；;\n：:]+/u).some((part) => normalize(part) === needle))) return 'verified'
  throw new Error(
    'statement rejected: this text does not appear in anything the learner typed in this session. ' +
    'Statements on the target map must be the learner\'s own words — copy their wording exactly, ' +
    'or ask them to write or revise it themselves. Do not summarize the rule for them.',
  )
}

export const kpGet = {
  name: 'kp_get',
  description:
    'Show one knowledge point\'s 渐构靶图 (target map): each model\'s user statement (upper layer) and its examples and recent verifications (lower layer). ' +
    'The learner sees it as a card. Also returns the reference rules you defined, which you must not reveal before the learner states the rule themselves.',
  parameters: { kpId: str('知识点 id', { required: true }) },
  readOnly: true,
  async execute(args, env) {
    const kp = await store.requireKp(env.cwd, args.kpId)
    const verifications = await loadVerifications(env.cwd)
    refreshMastery(kp, verifications, gateOf(env))
    const view = targetMapView(kp, verifications)
    const refs = kp.models.map((m) => `- ${m.id} ${describeModel(m)}：${m.reference}`).join('\n')
    const factLevels = factMasteries(verifications.filter((v) => v.kpId === kp.id), gateOf(env), factsWithIds(kp))
    const facts = kp.facts?.length ? '\n\n记忆卡：\n' + factsWithIds(kp).map((f, i) => `- ${f.id}: ${f.prompt} → ${f.answer}（${LEVEL_LABEL[factLevels[i]]}）`).join('\n') : ''
    return `${view}\n\n[仅供导师参考，在用户自己写出前不要直接告诉用户]\n${refs || '（尚未定义模型）'}${facts}`
  },
}

export const kpDefineModels = {
  name: 'kp_define_models',
  description:
    'Step ① 描述知识. For a knowledge point, define its models: usually an input-concept discriminative model, an output-concept discriminative model, ' +
    'and an input→output associative model. `reference` is YOUR description of the rule, used by the examiner and checker; the learner\'s own statement is recorded separately. ' +
    'For an information point, give `facts` (flashcards) instead. Reusing a model id keeps progress only for an unchanged definition; after any answer, a changed definition needs a new id.',
  parameters: {
    kpId: str('知识点 id', { required: true }),
    models: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: str('模型 id，如 in / out / map', { required: true }),
          type: str('discriminative 判别 / associative 联结', { enum: ['discriminative', 'associative'], required: true }),
          concept: str('判别模型：被判别的概念'),
          input: str('联结模型：输入概念'),
          output: str('联结模型：输出概念'),
          reference: str('参考规律：判别模型写共有属性（满足什么就是该概念），联结模型写输入如何决定输出', { required: true }),
        },
      },
    },
    facts: {
      type: 'array',
      description: '信息类知识点的记忆卡',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: { id: str('稳定卡片 id；新增可省略，重存沿用'), prompt: str('提问', { required: true }), answer: str('答案', { required: true }) },
      },
    },
  },
  async execute(args, env) {
    const kp = await store.requireKp(env.cwd, args.kpId)
    if (kp.kind === 'information') {
      if (args.models?.length) throw new Error(`${kp.id} is information: give facts, not models (or re-plan it as knowledge)`)
      if (!args.facts?.length) throw new Error('give at least one fact for an information point')
      const oldFacts = factsWithIds(kp)
      const verifications = await loadVerifications(env.cwd)
      const seen = new Set()
      const facts = args.facts.map((fact) => {
        const old = fact.id ? oldFacts.find((f) => f.id === fact.id) : oldFacts.find((f) => f.prompt === fact.prompt && f.answer === fact.answer && !seen.has(f.id))
        const id = fact.id ?? old?.id ?? store.newId('f')
        store.safeId(id)
        if (seen.has(id)) throw new Error(`duplicate fact id ${id}`)
        seen.add(id)
        if ((!old || old.prompt !== fact.prompt || old.answer !== fact.answer) && verifications.some((v) => v.kpId === kp.id && (v.factId === id || (!v.factId && (old || id === 'fact-1'))))) {
          throw new Error(`${id}: an answered fact cannot change its definition; use a new fact id`)
        }
        return { ...fact, id }
      })
      kp.facts = facts
      refreshMastery(kp, verifications, gateOf(env))
      if (kp.phase === 'describe') kp.phase = 'memorize'
      await saveKp(env, kp)
      return `已保存 ${kp.facts.length} 张记忆卡：${kp.facts.map((f) => f.id).join('、')}。${kp.phase === 'memorize' ? '进入记忆阶段。' : ''}${PHASE_GUIDE[kp.phase]}`
    }
    if (!args.models?.length) throw new Error('give at least one model for a knowledge point')
    const verifications = await loadVerifications(env.cwd)
    const next = []
    for (const spec of args.models) {
      store.safeId(spec.id)
      if (next.some((n) => n.id === spec.id)) throw new Error(`duplicate model id ${spec.id}`)
      if (spec.type === 'discriminative' && !spec.concept) throw new Error(`${spec.id}: a discriminative model needs concept`)
      if (spec.type === 'associative' && (!spec.input || !spec.output)) throw new Error(`${spec.id}: an associative model needs input and output`)
      const old = kp.models.find((m) => m.id === spec.id)
      const changed = old && ['type', 'concept', 'input', 'output', 'reference'].some((key) => old[key] !== spec[key])
      if ((!old || changed) && verifications.some((v) => v.kpId === kp.id && v.modelId === spec.id)) {
        throw new Error(`${spec.id}: an answered model cannot change its definition; use a new model id`)
      }
      next.push({
        ...(old ?? { phase: 'assess', mastery: 'none', targetMap: { statement: null, examples: [] } }),
        ...spec,
      })
    }
    const removed = kp.models.filter((m) => !next.some((n) => n.id === m.id)).map((m) => m.id)
    kp.models = next
    refreshMastery(kp, verifications, gateOf(env))
    await saveKp(env, kp)
    return `已定义 ${next.length} 个模型${removed.length ? `（移除 ${removed.join(', ')}）` : ''}，进入评估学况。${PHASE_GUIDE.assess}`
  },
}

export const kpSetPhase = {
  name: 'kp_set_phase',
  description:
    'Move one model (or an information point) to another teaching phase. Allowed: describe→assess→prescribe→build→verify; build→prescribe; verify→assess; ' +
    'any→describe to re-split the knowledge; information: describe→memorize. `mastered` is set only by verification_record.',
  parameters: {
    kpId: str('知识点 id', { required: true }),
    modelId: str('模型 id；信息类知识点省略'),
    phase: str('目标阶段', { enum: ['describe', 'assess', 'prescribe', 'build', 'verify', 'memorize'], required: true }),
    reason: str('为什么切换', { required: true }),
  },
  async execute(args, env) {
    const kp = await store.requireKp(env.cwd, args.kpId)
    if (kp.kind === 'information') {
      const error = transitionError('information', kp.phase, args.phase)
      if (error) throw new Error(error)
      kp.phase = args.phase
      await saveKp(env, kp)
      return `${kp.id} → ${args.phase}。${PHASE_GUIDE[args.phase]}`
    }
    if (!args.modelId) throw new Error(`modelId is required for a knowledge point; models: ${kp.models.map((m) => m.id).join(', ')}`)
    const model = store.findModel(kp, args.modelId)
    const error = transitionError('knowledge', model.phase, args.phase)
    if (error) throw new Error(error)
    model.phase = args.phase
    await saveKp(env, kp)
    return `${kp.id}/${model.id} → ${args.phase}。${PHASE_GUIDE[args.phase]}`
  },
}

export const targetMapUpdate = {
  name: 'target_map_update',
  description:
    'Edit one model\'s target map. `statement` records the learner\'s own statement of the rule (内涵 for a discriminative model, 映射规律 for an associative one) — ' +
    'it must be the learner\'s exact words from this conversation and is rejected otherwise. `addExamples` adds lower-layer examples; AI-made examples should be checked first. ' +
    'Pass `show: true` to show the learner the updated card.',
  parameters: {
    kpId: str('知识点 id', { required: true }),
    modelId: str('模型 id', { required: true }),
    statement: str('用户的原话（逐字）'),
    addExamples: { type: 'array', items: exampleSpec },
    markChecked: strArray('已通过 checker 校验的例子 id'),
    removeExampleIds: strArray('删除的例子 id（例如校验发现错误的例子）'),
    show: { type: 'boolean', description: '更新后向用户展示靶图卡片' },
  },
  async execute(args, env) {
    const kp = await store.requireKp(env.cwd, args.kpId)
    const model = store.findModel(kp, args.modelId)
    for (const example of args.addExamples ?? []) {
      if (example.origin === 'material' && !example.source?.trim()) throw new Error('material examples need a source block ref or URL')
      if (example.source !== undefined) await validateSources(env.cwd, [example.source])
    }
    const notes = []
    if (args.statement !== undefined) {
      const status = assertUserWords(args.statement, env)
      const prev = model.targetMap.statement
      model.targetMap.statement = {
        text: args.statement,
        source: 'user',
        verified: status === 'verified',
        history: prev ? [...prev.history, { text: prev.text, at: prev.at }] : [],
        at: env.now().toISOString(),
      }
      notes.push(prev ? '已更新用户表述' : '已记录用户表述')
    }
    if (args.removeExampleIds?.length) {
      const before = model.targetMap.examples.length
      model.targetMap.examples = model.targetMap.examples.filter((e) => !args.removeExampleIds.includes(e.id))
      notes.push(`删除例子 ${before - model.targetMap.examples.length} 个`)
    }
    for (const id of args.markChecked ?? []) {
      const example = model.targetMap.examples.find((e) => e.id === id)
      if (!example) throw new Error(`no example ${id} on ${kp.id}/${model.id}`)
      example.checked = true
    }
    if (args.markChecked?.length) notes.push(`标记已校验 ${args.markChecked.length} 个`)
    for (const e of args.addExamples ?? []) {
      model.targetMap.examples.push({ id: nextExampleId(model), ...e, checked: e.checked ?? false, at: env.now().toISOString() })
    }
    if (args.addExamples?.length) {
      const unchecked = args.addExamples.filter((e) => e.origin === 'ai' && !e.checked).length
      notes.push(`新增例子 ${args.addExamples.length} 个${unchecked ? `，其中 ${unchecked} 个 AI 例子未校验，请交给 checker` : ''}`)
    }
    refreshMastery(kp, await loadVerifications(env.cwd), gateOf(env))
    await saveKp(env, kp)
    const summary = notes.join('；') || '无改动'
    return args.show ? `${summary}\n\n${targetMapView(kp, await loadVerifications(env.cwd))}` : summary
  },
}
