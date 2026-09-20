---
name: sdd-verify
description: Apply, verify, and optionally archive an already planned SDD change.
---

## Parent preflight transport guard

仅在交互式父会话已解析 SDD 预检、并将其精确渲染的 `## SDD Session Preflight` 块注入每个子上下文之后运行。链及其 RPC 子代理必须消费该传输，绝不推断、确认、发起或持久化默认值。Missing or malformed transport blocks the chain before its first phase.

## sdd-init

output: init.md
outputMode: file-only
progress: true

在执行/验证之前为 {task} 初始化 SDD 上下文。若产物存储为 `openspec` 或 `both` 且 `openspec/config.yaml` 缺失，检查项目并自动创建它。若产物存储为 `engram` 或 `none`，跳过 OpenSpec 文件创建。若 `openspec/config.yaml` 已存在，读取它并报告当前 SDD/测试配置而不阻塞链。

## sdd-apply

reads: init.md
output: apply-progress.md
outputMode: file-only
progress: true

为 {task} 实现待处理的已批准任务；以严格 TDD 证据更新 OpenSpec 任务和 apply 进度。

## sdd-verify

reads: init.md+apply-progress.md
output: verify-report.md
outputMode: file-only
progress: true

使用 apply 进度和项目产物为 {task} 运行聚焦和完整验证。包含评审/裁判阻塞项。`verify-report.md` 以强制的围栏 `gentle-ai.verify-result/v1` YAML 封套作为首个非空内容开始，并在持久化之前对封套做字节检查（精确的 `requirements`/`scenarios` 计数、所有字段格式良好）；任何偏差都不持久化任何内容——进程内权威会拒绝 `evidence_revision` 与封套不匹配的结算。

## sdd-sync

reads: init.md+apply-progress.md+verify-report.md
output: sync-report.md
outputMode: file-only
progress: true

为 {task} 把已验证的文件承载增量规格同步到 `openspec/specs/` 而不归档。在 Engram-only 模式下，报告权威同步不适用。

## sdd-archive

reads: verify-report.md+sync-report.md
output: archive-report.md
outputMode: file-only
progress: true

仅在验证成功且文件承载同步已完成或不适用时归档 {task}。若验证或同步失败，保持产物活跃并报告阻塞项。
