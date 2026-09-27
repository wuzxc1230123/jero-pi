---
name: {domain}
description: "当仓库含 {标记文件1}、{标记文件2}，或任务涉及 {任务词1}、{任务词2}、{任务词3} 时使用。{领域一句身份}：开发惯例、命令用法与评审清单。"
---

# {领域} 开发模块

## 身份

{两三句：本模块覆盖什么（语言/引擎/框架）、不覆盖什么、知识来源。}

## 领域知识索引

- `references/{conventions}.md` —— {何时读：日常实现前的惯例}
- `references/{testing}.md` —— {何时读：写测试/跑验证前}
- `references/{review-checklist}.md` —— {何时读：评审本领域变更时}
- `references/{design}.md` —— {按需：设计拆解时的领域模型}

## 命令速览

构建 `{build}` · 测试 `{test}` · Lint `{lint}`。权威值钉在 `openspec/config.yaml`；本节仅速览，与 config 冲突时以 config 为准。

## 委派路由

- 需求/系统设计分析：委派 `{domain}-designer` 产出提案。
- 评审 {领域} 变更：常规评审之外追加委派 `{domain}-reviewer`。
- 执行实现：直接使用 `jero-worker`（本技能注入的知识随之生效，不建语言执行代理）。
