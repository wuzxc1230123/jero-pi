---
name: 4r-review
description: One-shot lens-only 4R discovery against a supplied initial review tree; the controller owns all authority.
---

> 仅限手动/兼容通道：提供方宿主中继捕获路径绝不加载此链；其存在仅为显式的手动 4R 调用。

## review-risk

output: review-risk-report.md
outputMode: file-only
progress: true

对所提供的 `initial_review_tree` 恰好运行一次 R1 Risk。返回安全、权限边界、数据暴露、依赖和阻塞合并漏洞的候选行。若干净，返回空候选清单。

## review-resilience

output: review-resilience-report.md
outputMode: file-only
progress: true

对所提供的 `initial_review_tree` 恰好运行一次 R4 Resilience。返回回退、重试/退避、优雅降级、可观测性、负载、回滚和 SLO 风险的候选行。若干净，返回空候选清单。

## review-readability

output: review-readability-report.md
outputMode: file-only
progress: true

对所提供的 `initial_review_tree` 恰好运行一次 R2 Readability。返回命名、复杂度、意图、可维护性、评审规模和上下文清晰度的候选行。若干净，返回空候选清单。

## review-reliability

output: review-reliability-report.md
outputMode: file-only
progress: true

对所提供的 `initial_review_tree` 恰好运行一次 R3 Reliability。返回行为优先的测试覆盖、边界情形、确定性、契约和回归的候选行。若干净，返回空候选清单。
