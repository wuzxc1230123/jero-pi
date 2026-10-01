---
name: godot-verify
description: 对 Godot 项目执行三道门验证（headless import → parse 检查 → 测试/跑起来看一眼）并产出带退出码证据的验证报告。当用户要求验证 Godot 项目能否构建/运行、跑检查、验证改动时使用。触发词：Godot 验证、验证 Godot、godot verify、headless 检查、parse 检查、跑一下 Godot 项目、验证游戏能跑。
---

# Godot 项目验证·三道门（Godot 4.x headless）

本技能是验证协议的执行入口：结论只认退出码与磁盘产物。深度协议住模块 references（L2，路径经模块知识入口注入，按需读）。

> **相关技能：** 测试脚手架与逐台执行 → 代理 `godot-tester`；缺陷修复 → `jero-worker`。

## 何时使用

用户要求验证 Godot 项目能否构建/运行、跑检查、验证改动时使用；实现功能代码与修复缺陷不归本技能管。

## 执行步骤

1. **定位引擎**：按序解析 `godot` 可执行文件（项目本地约定 → engine.path 记录 → PATH）；`godot --version` 记录版本。不可用即回报 `NOT VERIFIED` 与原因，终止。
2. **第一道门 headless import**：`godot --headless --path . --import`，记录退出码。非 0：报告工程不可导入与输出摘录，终止（不进后续门）。
3. **第二道门 parse 检查**：`tests/parse_check.gd` 缺失时按 verification.md 金样创建（`SceneTree` + `_initialize()` + `load()`，参数收 `--` 之后）；对涉及变更的 `.gd` 逐个跑，记录 `ok/PARSE FAIL` 与退出码。
4. **第三道门测试与观察**：有 gdUnit4 套件则 headless 运行（命令实测跑通后再用）；玩家可见变更提示启动观察并截图留证——未执行就如实写 `NOT VERIFIED`（人工项），绝不伪装通过。
5. **产出验证报告**：逐门列命令、引擎版本、退出码、输出摘录、结论（`PASS | FAIL | NOT VERIFIED`）与未覆盖清单。

## 红线

- 结论只认**退出码与磁盘产物**；"应该没问题"、"编译器没报错"不是证据。
- 不实现功能代码；发现缺陷报告给编排者（修复走 `jero-worker`）。
- 解析通过 ≠ 跑得起来：跳过第三道门必须在报告里显式声明，静默跳过即违规。

## 深读指路（references/）

三道门深度协议：`references/verification.md`；测试策略见 `references/testing.md`；发布前的最后一道门（真实导出）见 `references/export-publishing.md`。
