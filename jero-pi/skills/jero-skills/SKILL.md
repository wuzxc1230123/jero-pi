---
name: jero-skills
description: "jero 能力路由器：当用户不确定该用哪个 jero 技能、斜杠命令或工具时，或需要概览 jero-pi 全部能力面时使用。按场景（规划、SDD、省代码、评审、提交、发布、诊断、记忆）把意图映射到正确的入口。"
license: MIT
---

# Jero 能力路由器

回答一个问题：**这个处境该用哪个入口？** 维护规则同 ask-matt 之律——新增、删除或改名任何技能/命令时不同步本表，路由器就在撒谎。

## 场景 → 入口

| 处境 | 入口 |
|---|---|
| 会话开始，要建立编排/初始化 agent 团队 | `/agents-init`（prompt 命令） |
| SDD 流程：初始化技术栈 → 查状态 → 继续下一阶段 | `/jero-sdd-init` → `/jero-sdd-status` → `/jero-sdd-continue`；安装前预检 `/jero:sdd-preflight` |
| 大型工作要拆给子代理 | `subagent_run/status/result/cancel` 工具族；编排纪律见 `jero` 技能 |
| 写代码前，想用最少的必要代码交付 | `jero-lean` 技能（七级梯子）；切档 `/jero:lean`（off/lite/full/ultra） |
| diff 写完，要做精益评审 | `jero-lean-review`（delete/stdlib/native/yagni/shrink 标签） |
| 正式评审生命周期 | `jero_review` 工具（inspect/start/assess/finalize/validate/recover） |
| 发布前双盲终审 | `judgment-day`（显式触发词激活） |
| 提交切分 / 分支 PR / 大变更链式 PR | `jero-work-unit-commits` · `jero-branch-pr` · `jero-chained-pr` |
| 查当前工作树改动与用量 | `/jero:changes` `/jero:usage` |
| 缺陷工作流（复现→根因→修复→回归） | `jero-rdd-defect-workflow` |
| 有意的妥协要登记债务 | `jero-debt`（`jero:` 注释：`ceiling:` + `upgrade:`） |
| 写面向认知的文档 / 注释 | `jero-cognitive-doc-design` · `jero-comment-writer` |
| 建 issue | `jero-issue-creation` |
| 创建 / 改进技能 | `jero-skill-creator` · `jero-skill-improver`；写作规范见 `docs/skill-authoring.md` |
| 技能增删后刷新索引 | `/skill-registry:refresh`（或自动重扫）；机器索引在 `.atl/skill-registry.md` |
| 发布 | `jero-release` |
| 体检 / 状态诊断 | `/jero:doctor` `/jero:status` `/jero:guard` |
| 跨会话记忆 | `mem_save/mem_read/mem_list/mem_search` 工具 |
| 评审会话常任权限 / RDD 开关 | `/jero:review-session-permission` `/jero:review-mode` |

## 判据

- 入口是**技能**（模型按 description 自主触发，或用户点名）、**斜杠命令**（人打）、还是**工具**（模型在会话中直接调用）——上表已按此分列。
- 一个处境命中多个入口时，先给最窄的那个；把本表当目录，不当教程。
