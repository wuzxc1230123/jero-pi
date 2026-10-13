---
name: godot-export
description: 导出与发布：Export Presets 基线、Export Templates 版本对齐、真实导出并启动产物验证、itch/Steam 发布。当打包发布、配导出预设或排查"编辑器能跑导出白屏"时使用。触发词：导出、发布、export、打包、build、presets、itch、Steam、模板、产物。
---

# 导出与发布（Godot 4.x）

管"怎么把游戏交出去"：导出是验证回路的最后一道门。深度知识住模块 references（L2，路径经模块知识入口注入，按需读）。

> **相关技能：** 三道门验证 → `godot-verify`（能 import ≠ 能导出能跑）；资源导入管线 → `godot-assets`；插件提交卫生 → 深读 `references/addon-development.md`。

## 何时使用

配置导出预设、打包平台产物、发布到 itch/Steam、排查导出后运行异常时使用；编辑器内的功能问题不归本技能管。

## 核心要点

- **导出前先对齐 Export Templates 版本**：模板与编辑器版本错位 = 导出即失败；CI 里 `--version` 对齐后再跑。
- Presets 基线：每平台一份 preset，包含/排除资源清单显式维护（`*.gd` 通配别漏 `addons/`）；图标与版本号进 preset 不散落。
- **发布前必须真实导出并启动一次产物**——"能 import ≠ 能导出能跑"；产物启动留证（截图/退出码）进发布记录。
- itch/Steam 平台差异（如 Steam 需 depot/构建工具链）在深读参考；导出产物先本地跑通再上传。

## 红线

- 只在编辑器里点导出不验证产物（白屏/缺资源只有启动才显形）。
- 排除清单把 `addons/` 或 `.import` 相关产物漏掉（运行时资源缺失）。
- 发布流程带开发期插件/活会话配置进包（见 `editor-live-session.md` 纪律）。

## 深读指路（references/）

导出与发布全文（presets 基线/平台差异/itch 与 Steam 流程）：`references/export-publishing.md`。
