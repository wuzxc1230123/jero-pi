---
name: jero-skill-improver
description: "触发词：改进技能、审计技能、重构技能、技能质量。审计并升级既有 LLM 优先技能。"
license: Apache-2.0
metadata:
  author: gentleman-programming
  version: "1.0"
---

## 激活契约

审计、重构、规范化或改进既有 `SKILL.md` 文件时，使用本技能。从可复用模式创建全新技能时，使用 `jero-skill-creator`。

## 硬性规则

- 先读 `docs/skill-style-guide.md`，并把它当作规范风格契约。
- 把 `SKILL.md` 当作事实来源；保留作者意图、关键规则、激活语义与输出要求。
- 可用时，把 `.atl/skill-registry.md` 当作技能名、触发词、范围与精确路径的索引。
- 默认只审计。仅当用户明确要求应用改进时才修改文件。
- 绝不静默删除有意义的内容；把长解释、示例、模板或 schema 移入本地 `references/` 或 `assets/`。
- 不要发明触发词、策略或领域规则。把含糊情形标记为需人工评审。

## 决策门

| 情形 | 动作 |
| --- | --- |
| frontmatter 缺失或非法 | 修复 `name`、带引号的单行 `description`、`license` 与 `metadata` |
| 技能读起来像教程文档 | 转为运行时指令，把背景移入 `references/` |
| 正文超预算 | 保留规则，把示例/背景移入支撑文件 |
| 分支逻辑藏在散文里 | 转为紧凑的决策表 |
| 规则冲突或意图不清 | 报告问题；不要自动改写该规则 |

## 执行步骤

1. 读 `docs/skill-style-guide.md`。
2. 读 `.atl/skill-registry.md`；用列出的路径选择技能。若缺失，扫描已知技能目录中的 `*/SKILL.md`。
3. 对每个选中的技能，审计元数据、触发清晰度、小节顺序、正文预算、可执行性、决策门、输出契约与本地参考。
4. 返回按技能分组、带严重度与精确修改建议的审计报告。
5. 应用模式下只编辑安全问题，保留内容，需要时创建支撑文件，然后刷新或请求 `/skill-registry:refresh`。

## 输出契约

返回：
- 审计的技能与使用的路径。
- 发现的问题，按严重度分组。
- 若请求了应用模式，列出改动的文件。
- 技能元数据或路径变化时的注册表刷新建议。
- 需要人工评审的含糊之处。

## 参考

- `docs/skill-style-guide.md` —— 规范的 LLM 优先技能风格指南。
- `skills/skill-registry/SKILL.md` —— 注册表刷新与索引契约。
