---
name: jero-module-creator
description: "触发词：模块创建、创建模块、语言包、扩展语言支持、module creator、create module，如「创建 godot 游戏开发模块」「给这个仓库加 java 支持」。在目标项目 .pi/ 下脚手架整个领域模块：技能 + 子代理 + 命令钉住 + 冒烟检查，零代码改动。"
license: Apache-2.0
metadata:
  author: gentleman-programming
  version: "1.0"
---

## 激活契约

用户要求为某语言/引擎/领域创建一整套扩展模块（技能 + 子代理 + 命令钉住）时使用，例如"创建 godot 游戏开发模块"。只改单个文件时各用其专用技能：单个子代理 → `jero-agent-creator`；单个技能 → `jero-skill-creator`。

## 硬性规则

- 产出全部落在目标项目 `.pi/`（技能进 `.pi/skills/{domain}/`，代理进 `.pi/agents/`），零代码、不碰包内受管资产与任何 `*.chain.md`。
- **不建语言执行代理**：执行用包内 `jero-worker`，领域知识经本模块技能注入。代理只做角色/权限真正不同的实体（评审必建、设计按需）。
- 技能门控词用**精确文件名**（`project.godot`、`pom.xml`、`*.csproj`），与既有模块的门控集合互斥；description 单行、触发词在最前。
- 生成技能短正文 + `references/` 深知识，禁在 description 里总结流程（细则见 `docs/skill-authoring.md`）。
- `openspec/config.yaml` 只改真实存在的键（`rules.apply.test_command`、`rules.verify.test_command`、`testing.runner.command/framework`、`quality.lint/typecheck/format`）；文件不存在时提示先跑 `/jero-sdd-init`，不凭空生成整份。
- 命令必须可验证：钉进 config 前先在目标项目实际跑通一次；引擎无廉价 headless 测试时（如 Unity），用 Makefile/脚本包装并钉 `make test`。
- 完成后必须跑本技能的冒烟检查并如实报告结果。

## 决策门

| 处境 | 动作 |
| --- | --- |
| 目标项目已有该领域模块 | 更新既有文件，绝不重建覆盖 |
| 引擎/语言已有探测内置（如 Go） | 跳过命令补偿，只补惯例知识 |
| 领域只有知识、无角色差异 | 只生成技能，代理省略 |
| 用户要求代理进固定评审链 | 如实说明属代码改动（进包加链），零代码下用委派路由替代 |

## 执行步骤

1. **领域访谈**：按 `assets/interview.md` 逐项收集（标记文件、任务词、命令、惯例来源、评审关注点、是否需要设计角色）。
2. **命名与碰撞检查**：定 `{domain}` 前缀，对照包内前缀族（`jero-*`/`review-*`/`sdd-*`/`jd-*`）与项目 `.pi/` 现有资产。
3. **生成技能**：按 `assets/module-skill.template.md` 写 `.pi/skills/{domain}/SKILL.md`（含委派路由段），领域知识写入 `references/`（惯例、命令用法、评审清单、按需的设计知识）。
4. **生成代理**：按 `jero-agent-creator` 契约用其模板生成 `{domain}-reviewer.md`（必）与 `{domain}-designer.md`（设计密集领域才要）。
5. **钉命令**：按 `assets/config-pins.template.yaml` 更新 `openspec/config.yaml`；先跑通再落键。
6. **冒烟检查**五步：技能计数 +1 → `.atl/skill-registry.md` 在列且 Trigger 含门控词 → 仓库技术栈问答能触发注入 → 点名委派新代理可达 → 与包内前缀族无重名。

## 输出契约

返回：生成的目录树、文件清单、门控词集合、钉住的命令及验证结果、代理清单（含为何省略或保留）、冒烟检查五步逐项结果。

## 参考

- `docs/extension-guide.md` —— 扩展模型、放置决策与错误避免的单一事实源。
- `jero-agent-creator` / `jero-skill-creator` —— 单件资产的编写契约。
- `skills/jero-skills/SKILL.md` —— 宿主能力路由表（模块装好后按场景走常规入口）。
