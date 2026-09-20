---
name: jero-chained-pr
description: "触发词：超过 400 行的 PR、堆叠 PR、评审切片。把过大变更拆分为链式 PR，保护评审专注度。"
license: Apache-2.0
metadata:
  author: gentleman-programming
  version: "1.0"
---

## 激活契约

当计划中的 PR 可能超过 **400 行改动**、SDD 预测出 `400-line budget risk: High` 或 `Chained PRs recommended: Yes`，或用户要求链式/堆叠 PR、评审切片或评审者负载控制时，加载本技能。

## 硬性规则

- 除非维护者明确接受 `size:exception`，超过 **400 行改动**的 PR 必须拆分。
- 该预算约束的是工作的**切分**方式，绝不是代码本身。绝不为凑进预算而删除注释、空行、文档或测试，也绝不压缩或重排代码风格。
- 切分是有界的：只做**一次**诚实的切分尝试。若无任何内聚拆分能让每个切片都进预算，停止迭代，保留最佳内聚拆分，并报告最终行数与 `size:exception` 建议。
- 每个 PR 应可在约 **≤60 分钟**内完成评审。
- 每个 PR 对应一个可交付工作单元；测试/文档与其验证的对象留在同一单元。
- 每个链式 PR 都必须说明起点、终点、前置依赖、后续工作与范围外事项。
- 每个子 PR 必须附一张依赖图，用 `📍` 标出当前 PR。
- 功能分支链中，创建一个 draft/禁合并的追踪 PR；子 PR #1 以追踪分支为目标，后续子 PR 以直接父分支为目标。
- 把受污染的 diff 视为基础缺陷：重定目标或 rebase，直到 diff 只含当前工作单元。
- 用户选定链策略后不得混用其他策略。

## 决策门

| 条件 | 动作 |
|---|---|
| PR ≤400 行改动且聚焦 | 保持单个 PR。 |
| PR >400 行，每个切片可独立合入 | 使用 Stacked PRs 到 main。 |
| PR >400 行，功能必须先集成再进 main | 使用带追踪 PR 的 Feature Branch Chain。 |
| 生成/供应商/迁移 diff 无法干净拆分 | 请维护者给 `size:exception`。 |
| 一次切分后仍无内聚拆分能进预算 | 停止；交付最佳拆分，报告超出量与无法再缩小的原因，并建议 `size:exception`。 |
| SDD 给出 `delivery_strategy` | 在 apply/创建 PR 前遵循它。 |

## 执行步骤

1. 估算改动行数并识别独立的工作单元。
2. 当无缓存策略且超出预算时，询问链策略。
3. 只使用所选策略创建分支/PR。
4. 为每个 PR 添加 Chain Context，不替换仓库 PR 模板。
5. 独立验证每个 PR：CI/测试/文档/手工检查、回滚范围与干净 diff。
6. 追踪 PR 保持 draft/禁合并，直到所有子 PR 评审并集成完毕。

## 输出契约

返回所选策略、PR 顺序、当前 PR 边界、依赖图、评审预算（`additions + deletions`）、验证计划以及任何 `size:exception` 理由。

## 参考

- [references/chaining-details.md](references/chaining-details.md) —— 策略图、PR 正文小节、分支命令与评审者指引。
