---
name: make-materials
description: Use when a model is in the prescribe phase — prepare rule explanations, examples, counter-examples, and analogies that follow the latest prescription, get AI-made examples checked, and present them.
---

# 制定材料（第 ③ 步）

## 1. 先找现成的
- 用 `material_search` 找候选，再用 `material_read` 读原文；搜索摘要只用于选块。材料里的例子优先（origin=material，source 写实际读取的完整块 id）。
- 材料不够时用 `web_search` 找权威资料，或自己生成（origin=ai）。

## 2. 按处方准备
| 标签 | 内容 | 要求 |
|---|---|---|
| `#d` 规律讲解 | 共有属性 / 映射规律 | 每讲一条规律，后面都要跟一个对应的例子 |
| `#e` 例子 | 正例、反例、对比组 | 每个例子都写清楚它为什么符合或不符合规律（reasoning） |
| `#t` 类比 / 对比 | 借用户已懂的概念（learner.knownConcepts） | 指出类比在哪里**不**成立，防止负迁移 |

- **因素**材料：哪些输入因素会影响结果；**关系**材料：结果怎样随输入变化。联结模型两类都要有。
- 反例最好是「表面很像、只缺一个关键属性」的，这样最能逼出规律。
- 例子贴近用户的生活和已有经验；诊断是下层丢失时，抽象程度再降一级。
- 先例子还是先规律，按 preferOrder。

## 3. 校验规律和例子
把关键规律、转述的讲解和新生成的例子（每条带临时编号）交给 `checker`；`sources` 传实际依据的块 id 或已核对的 URL。要求它对照原文检查关键说法是否成立、有没有漏掉条件，再检查例子。原文直接摘录的例子读过后可直接使用。
- 不通过的：修改后重新校验，或者丢掉。
- 存疑的：补读材料；无法确认时明确说明依据不足，保持未校验。
- 通过的：`target_map_update` 的 `addExamples` 写入，`checked: true`。

## 4. 展示给用户
- 一次只给一小块：一条规律加 1～2 个例子，或一组对比例，一条回复大约 400 字以内。不要一次把材料全倒出来。用户选了「先看规律」也一样：先讲最核心的那一条，用户说完自己的理解再讲下一条；类比、背景、「为什么这样设计」留到后面。
- 有教材依据的关键说法旁标注块 id；转述、类比和生成的情境按实际来源标注，引用说明其依据，不把生成内容称为教材原文。写入例子时保留对应 `source`。
- **先别把所有例子都讲完**：留几个当练习题（例习循环），做完再变成例子。
- 让用户判断或比较这些案例时，按 coach-statements 的「理解练习题卡」用 `quiz_show(purpose="practice")`，放到右侧学习区；只讲解或请用户归纳时留在正文。
- 展示完调用 `kp_set_phase(phase="build")`，加载 `coach-statements`。
