---
name: jero-agent-creator
description: "触发词：子代理创建、创建代理、agent creator、create subagent、新建子代理。在目标项目 .pi/agents/ 下创建单个领域子代理：frontmatter 契约、权限面选择、命名防撞、委派接线。"
license: Apache-2.0
metadata:
  author: gentleman-programming
  version: "1.0"
---

## 激活契约

为某个领域创建或更新**单个**项目级子代理（`.pi/agents/*.md`）时使用本技能。要一次创建整套领域资产（技能 + 代理 + 命令钉住），改用 `jero-module-creator`。

## 硬性规则

- 代理的价值在**角色与权限面不同**，不在语言知识。与 `jero-worker` 同角色、只多领域知识的"执行代理"一律不做——知识进技能（`jero-skill-creator`）。
- 命名带领域前缀（`{domain}-reviewer`、`{domain}-designer`），**永不**与包内前缀族 `jero-*`、`review-*`、`sdd-*`、`jd-*` 重名——同名会静默遮蔽包内代理，是唯一能破坏流程的错误。
- frontmatter 只用 `name` / `description` / `tools`（可选 `model` / `thinking` / `mode`）。只读代理用 `"*": false` 先关默认再开允许清单。
- 只报告发现的评审代理，输出契约必须对齐发现台账：`severity: BLOCKER | CRITICAL | WARNING | SUGGESTION` + 受影响文件 + 证据；干净时返回零行台账，绝不跳过。
- 不创建、不修改任何 `*.chain.md` 与包内受管资产——代理进固定链属于代码改动，超出本技能范围，如实告知用户升级路径。

## 决策门

| 需求 | 动作 |
| --- | --- |
| 只读领域评审 | 用 `assets/reviewer.template.md` |
| 设计/提案角色（不写码） | 用 `assets/designer.template.md` |
| 与既有代理同角色、仅多知识 | 不建代理；转 `jero-skill-creator` 做技能 |
| 必须进链、每次机制性必跑 | 零代码做不到；说明需进包加链（`ASSET_OWNER_BY_KEY`）|
| 目标项目已有同名代理 | 更新既有文件，不叠加副本 |

## 执行步骤

1. 访谈三件事：角色（评审/设计/其他）、领域关注点、权限面（只读 or 需要写）。
2. 定名：`{domain}-{role}`；对照包内前缀族与目标项目 `.pi/agents/` 现有文件做碰撞检查。
3. 从模板生成 `.pi/agents/{name}.md`，填充领域规则与输出契约；`jero_review_scope` 工具仅在宿主装有 jero-pi 时保留。
4. 委派接线：若目标项目已有该领域的 `.pi/skills/{domain}/SKILL.md`，在其委派路由段加上本代理；没有则提示用户可用 `jero-module-creator` 生成完整模块。
5. 跑冒烟检查：点名让新代理做一件小事确认委派可达。

## 输出契约

返回：创建/修改的文件、选定名与碰撞检查结果、权限面选择及理由、委派接线位置、冒烟检查结果。

## 参考

- `docs/extension-guide.md` —— 放置位置、发现机制与错误避免的单一事实源。
- `jero-module-creator` —— 整套领域模块（技能 + 代理 + config 命令钉住）。
