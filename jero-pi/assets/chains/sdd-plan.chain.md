---
name: sdd-plan
description: Plan an SDD change through proposal, spec, design, and tasks; safe for auto mode or explicit all-planning approval.
---

## Parent preflight transport guard

仅在交互式父会话已解析 SDD 预检、并将其精确渲染的 `## SDD Session Preflight` 块注入每个子上下文之后运行。链及其 RPC 子代理必须消费该传输，绝不推断、确认、发起或持久化默认值。Missing or malformed transport blocks the chain before its first phase.

## 交互模式守卫

本链是一条连续的规划流水线。仅在自动模式或显式的全规划批准下使用。在交互模式下，父会话/编排器必须在 sdd-proposal 之后停下、展示提案并在继续到 sdd-spec、sdd-design 和 sdd-tasks 之前询问用户。

## sdd-init

output: init.md
outputMode: file-only
progress: true

在规划之前为 {task} 初始化 SDD 上下文。若产物存储为 `openspec` 或 `both` 且 `openspec/config.yaml` 缺失，检查项目并自动创建它。若产物存储为 `engram` 或 `none`，跳过 OpenSpec 文件创建。若 `openspec/config.yaml` 已存在，读取它并报告当前 SDD/测试配置而不阻塞链。

## sdd-proposal

reads: init.md
output: proposal.md
outputMode: file-only
progress: true

为 {task} 创建或更新 OpenSpec 提案。若项目产物中存在先前的探索，则使用它。若这是一次交互式 SDD 运行且父会话尚未提供塑形提案的答案，在结果中呈现缺失的问题，让父会话在把提案视为已批准之前先行询问。

## sdd-spec

reads: proposal.md
output: spec.md
outputMode: file-only
progress: true

使用提案和先前输出为 {task} 编写增量规格。保持需求与场景聚焦于验收。

## sdd-design

reads: proposal.md+spec.md
output: design.md
outputMode: file-only
progress: true

为 {task} 设计技术方案。保留原生 SDD 编排意图并识别评审/裁判风险。

## sdd-tasks

reads: proposal.md+spec.md+design.md
output: tasks.md
outputMode: file-only
progress: true

为 {task} 创建可评审的严格 TDD 实现任务。包含工作量预测和任何必需的交付决策。
