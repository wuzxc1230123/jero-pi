---
name: jero-work-unit-commits
description: "把提交规划为可评审的工作单元。触发词：实现、提交拆分、链式 PR，或让测试文档与代码同行。"
license: Apache-2.0
metadata:
  author: gentleman-programming
  version: "1.0"
---

## 何时使用

在决定每个提交或 PR 应包含什么时，加载本技能。

适用于：

- 把一个功能拆成可评审的工作。
- 打开 PR 前准备提交。
- 把大变更变成链式或堆叠 PR。
- 保持评审者认知负荷健康。
- 执行 SDD 任务而不意外产出超过 400 行改动的 PR。

## 关键规则

| 规则 | 要求 |
|------|-------------|
| 按工作单元提交 | 一个提交代表一个可交付的行为、修复、迁移或文档单元。 |
| 不按文件类型提交 | 避免先 `models`、再 `services`、再 `tests`，如果任何一层单独不能工作。 |
| 测试与代码同在 | 测试属于其验证的行为所在的同一提交。 |
| 文档与用户可见变更同在 | 文档属于其解释的功能或工作流。 |
| 讲一个故事 | 评审者应能从每个提交的 diff 与提交信息理解它为何存在。 |
| 面向未来 PR 就绪 | 变更增长时，每个提交应可成为链式 PR 的候选。 |
| SDD 工作量守卫 | 若 SDD 任务预测 >400 行变更，在实现前把提交分组为链式 PR 切片。 |
| 预算不是代码高尔夫 | 绝不靠删注释、空行、文档或测试，或压缩代码，把 diff 缩进评审预算（默认 400，或会话 `review_budget_lines`）。按工作单元切分，或报告超出量。 |

## 工作单元检查单

提交之前确认：

- [ ] 提交有单一明确的目的。
- [ ] 只应用这个提交后，仓库仍然合理。
- [ ] 相关时，包含该单元的测试或文档。
- [ ] 回滚合理，无需回退无关工作。
- [ ] 提交信息解释结果，而不是罗列文件。

## 拆分示例

| 弱拆分 | 更好的工作单元拆分 |
|------------|------------------------|
| `add models` | `feat(auth): add token validation domain model and tests` |
| `add services` | `feat(auth): wire token validation into login flow` |
| `add tests` | 测试随各行为提交一并包含 |
| `update docs` | 文档随其解释的用户可见变更一并包含 |

## 与 PR 的关系

把工作单元提交作为链式 PR 的基础：

1. 构建最小的独立工作单元。
2. 为该单元附带验证。
3. 用常规提交信息提交。
4. 若 PR 接近 400 行改动，把提交或提交组提升为链式 PR。

## 与 SDD 的关系

当 `sdd-tasks` 产出评审工作量预测时：

- 低风险：工作单元提交保留在一个 PR 内。
- 中风险：按工作单元提交，并在创建 PR 前监控改动行数。
- 高风险：遵循 SDD `delivery_strategy` —— `ask-on-risk` 时询问，`auto-chain` 时自动切片，超预算的 `single-pr` 要求 `size:exception`，`exception-ok` 时记录已接受的 `size:exception`。
- 拆分是有界的：一次诚实的切分尝试后，若无内聚的工作单元拆分能进预算，停止并报告最小的诚实计数与 `size:exception` 建议。不要为凑数反复缩小代码。

每个 SDD 工作单元应干净地映射到一个提交或 PR，具备：

- 清晰的起始状态，
- 清晰的完成状态，
- 同一单元内的验证，
- 不删除无关工作的回滚。

## 命令

```bash
# Review the story before committing
git diff --stat
git diff --cached --stat

# Check recent commit style
git log --oneline -5
```
