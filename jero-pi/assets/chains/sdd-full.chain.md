---
name: sdd-full
description: Run the full SDD lifecycle for a change in auto mode or explicit full-lifecycle approval.
---

## Parent preflight transport guard

仅在交互式父会话已解析 SDD 预检、并将其精确渲染的 `## SDD Session Preflight` 块注入每个子上下文之后运行。链及其 RPC 子代理必须消费该传输，绝不推断、确认、发起或持久化默认值。Missing or malformed transport blocks the chain before its first phase.

## 交互模式守卫

本链是一条连续的生命周期流水线。仅在自动模式或显式的全生命周期批准下使用。在交互模式下，父会话/编排器必须在每个阶段边界停下、展示当前产物并在继续之前询问用户。启动 SDD 的批准不等于对生成的提案、规格、设计、任务、执行、验证、同步或归档阶段的批准。

## sdd-init

output: init.md
outputMode: file-only
progress: true

在任何规划或实现之前为 {task} 初始化 SDD 上下文。若产物存储为 `openspec` 或 `both` 且 `openspec/config.yaml` 缺失，检查项目并自动创建它。若产物存储为 `engram` 或 `none`，跳过 OpenSpec 文件创建。若 `openspec/config.yaml` 已存在，读取它，仅在适当时刷新安全的派生上下文，并报告当前 SDD/测试配置而不阻塞链。

## sdd-explore

reads: init.md
output: exploration.md
outputMode: file-only
progress: true

探索 {task}。识别范围、风险、依赖、既有方案，以及该变更是否应进入提案。

## sdd-proposal

reads: exploration.md
output: proposal.md
outputMode: file-only
progress: true

使用探索笔记和上一步输出，为 {task} 创建或更新 OpenSpec 提案。若这是一次交互式 SDD 运行且父会话尚未提供塑形提案的答案，在结果中呈现缺失的问题，让父会话在把提案视为已批准之前先行询问。

## sdd-spec

reads: proposal.md
output: spec.md
outputMode: file-only
progress: true

从父会话批准的提案为 {task} 编写增量规格。保留 RFC 2119 需求和 Given/When/Then 场景。在交互模式下，不把链执行本身当作提案批准。

## sdd-design

reads: proposal.md+spec.md
output: design.md
outputMode: file-only
progress: true

使用提案、规格和先前输出为 {task} 设计技术方案。指出评审与裁判风险。

## sdd-tasks

reads: proposal.md+spec.md+design.md
output: tasks.md
outputMode: file-only
progress: true

为 {task} 创建严格 TDD、可评审的实现任务。包含必需的 Review Workload Forecast 守卫行和 PR 拆分建议。

## sdd-apply

reads: proposal.md+spec.md+design.md+tasks.md
output: apply-progress.md
outputMode: file-only
progress: true

只为 {task} 实现已批准的 implementation 归属任务；在激活时强制严格 TDD，并在工作量决策未解决时于写入之前停止。用证据更新 OpenSpec 任务和 apply 进度。实现完成后，直接继续独立验证。SDD 路由是 apply -> verify -> sync -> archive；阶段之间不要求 RDD 权威、回执或交付闸门。

## sdd-verify

reads: proposal.md+spec.md+design.md+tasks.md+apply-progress.md
output: verify-report.md
outputMode: file-only
progress: true

对照规格、设计、任务、实现、apply 进度、严格 TDD 证据、断言质量和评审工作量边界验证 {task}。

## sdd-sync

reads: proposal.md+spec.md+design.md+tasks.md+apply-progress.md+verify-report.md
output: sync-report.md
outputMode: file-only
progress: true

为 {task} 把已验证的文件承载增量规格同步到 `openspec/specs/` 而不归档。在 Engram-only 模式下，报告权威同步不适用。

## sdd-archive

reads: verify-report.md+sync-report.md
output: archive-report.md
outputMode: file-only
progress: true

仅在验证报告通过且文件承载同步已完成或不适用时归档 {task}；否则报告归档被阻塞并保留活跃产物。
