---
name: jero-module-creator
description: "触发词：模块创建、创建模块、语言包、扩展语言支持、module creator、create module，如「创建 godot 游戏开发模块」「给这个仓库加 java 支持」。在目标项目 .pi/ 下脚手架整个领域模块：技能 + 子代理 + 命令钉住 + 冒烟检查，零代码改动。"
license: Apache-2.0
metadata:
  author: jero-pi
  version: "1.0"
---

## 激活契约

用户要求为某语言/引擎/领域创建一整套扩展模块（技能 + 子代理 + 命令钉住）时使用，例如"创建 godot 游戏开发模块"。只改单个文件时各用其专用技能：单个子代理 → `jero-agent-creator`；单个技能 → `jero-skill-creator`。

## 硬性规则

- 产出全部落在目标项目 `.pi/`（模块进 `.pi/modules/{domain}/`，代理进 `.pi/agents/`），零代码、不碰包内受管资产与任何 `*.chain.md`。
- **每个模块一份 `module.json` 清单**（契约 `jero.module-contract/v1`，模板见 `assets/module-manifest.template.json`）：知识入口落 `.pi/modules/{domain}/knowledge/SKILL.md`（≤60 行含 frontmatter，模板见 `assets/module-entry.template.md`），深度知识进同模块 `references/`。字段规范见 `docs/module-contract.md`。
- **清单必须过安装验证**：生成后跑 `/jero-module-verify`，全部检查项绿灯才算交付；任何红项按报错修复而不是绕过。目标项目 `.pi/skills/` 已有同名松散技能时先迁移进模块（双轨重名会被拒），不并存。
- **不建语言执行代理**：执行用包内 `jero-worker`，领域知识经模块注入。代理只做角色/权限真正不同的实体（评审必建、设计按需），且清单 `roles[].isolation` 必须声明至少一条隔离正当理由，否则验证拒绝。
- 技能门控词用**精确文件名**（`project.godot`、`pom.xml`、`*.csproj`），与既有模块的门控集合互斥；description 单行、触发词在最前。
- `openspec/config.yaml` 只改真实存在的键（`rules.apply.test_command`、`rules.verify.test_command`、`testing.runner.command/framework`、`quality.lint/typecheck/format`）；文件不存在时提示先跑 `/jero-sdd-init`，不凭空生成整份。同时把钉住的测试命令写进清单 `config.testCommand`（覆盖层的 Strict TDD 数据源）。
- 命令必须可验证：钉进 config 前先在目标项目实际跑通一次；引擎无廉价 headless 测试时（如 Unity），用 Makefile/脚本包装并钉 `make test`。
- 完成后必须跑 `/jero-module-verify` 与本技能的冒烟检查并如实报告结果。

## 决策门

| 处境 | 动作 |
| --- | --- |
| 目标项目已有该领域模块 | 更新既有文件，绝不重建覆盖 |
| 引擎/语言已有探测内置（如 Go） | 跳过命令补偿，只补惯例知识 |
| 领域只有知识、无角色差异 | 只生成技能，代理省略 |
| 用户要求代理进固定评审链 | 如实说明属代码改动（进包加链），零代码下用委派路由替代 |

## 执行步骤

1. **领域访谈**：按 `assets/interview.md` 逐项收集（标记文件、任务词、命令、惯例来源、评审关注点、是否需要设计角色）。
2. **命名与碰撞检查**：定 `{domain}` 词元，对照包内前缀族（`jero-*`/`review-*`/`sdd-*`/`jd-*`）与项目 `.pi/` 现有资产。
3. **生成模块清单**：按 `assets/module-manifest.template.json` 写 `.pi/modules/{domain}/module.json`（触发器/知识/角色/接线/路由/配置四面一声明），词元全量替换 godot 金样。
4. **生成知识入口**：按 `assets/module-entry.template.md` 写 `.pi/modules/{domain}/knowledge/SKILL.md`（含 frontmatter 与委派路由段，≤60 行），领域深知识写入 `.pi/modules/{domain}/references/`。
5. **生成代理**：按 `jero-agent-creator` 契约用其模板生成 `{domain}-reviewer.md`（必）与 `{domain}-designer.md`（设计密集领域才要），与清单 `roles` 一一对应。
6. **钉命令**：按 `assets/config-pins.template.yaml` 更新 `openspec/config.yaml`；先跑通再落键，并同步进清单 `config.testCommand`。
7. **安装验证**：跑 `/jero-module-verify`——token/唯一/双轨（与松散技能重名即拒）/防遮蔽/触发命中/路由解析/隔离正当性/entry 行数/命令钉住全绿，`.atl/module-overlay.md` 生成。
8. **冒烟检查**五步：技能计数 +1 → `.atl/skill-registry.md` 在列且 Trigger 含门控词 → 仓库技术栈问答能触发注入 → 点名委派新代理可达 → 与包内前缀族无重名。

## 输出契约

返回：生成的目录树、文件清单、门控词集合、钉住的命令及验证结果、代理清单（含为何省略或保留）、`/jero-module-verify` 逐项结果、冒烟检查五步逐项结果。

## 参考

- `docs/module-contract.md` —— 模块契约规范（清单字段/编排面/保证谱）的单一事实源。
- `docs/extension-guide.md` —— 放置机制与错误避免的单一事实源。
- `jero-agent-creator` / `jero-skill-creator` —— 单件资产的编写契约。
- `skills/jero-skills/SKILL.md` —— 宿主能力路由表（模块装好后按场景走常规入口）。
