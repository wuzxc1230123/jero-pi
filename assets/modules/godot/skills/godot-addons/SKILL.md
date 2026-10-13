---
name: godot-addons
description: 插件与编辑器扩展：EditorPlugin 生命周期与成对注销、@tool 纪律、UndoRedo、dock/面板注册、GDExtension 选型与版本矩阵。当开发编辑器插件、自定义工具或 GDExtension 时使用。触发词：插件、addon、EditorPlugin、编辑器扩展、编辑器工具、自定义 dock、gdextension、C++ 扩展、AssetLib。
---

# 插件与编辑器扩展（Godot 4.x）

管"改编辑器体验用 EditorPlugin，跑得更快用 GDExtension"。深度知识住模块 references（L2，路径经模块知识入口注入，按需读）。

> **相关技能：** GDScript 规范（@tool 与类型纪律）→ `godot-gdscript`；C# 侧 → `godot-csharp`；插件脚本的解析验证 → `godot-verify`。

## 何时使用

写 EditorPlugin（dock/Inspector/导入器/编辑器工具）、选型或开发 GDExtension 时使用；给游戏加普通功能用节点 + 子场景，不配插件。

## 核心要点

- 生命周期成对：`_enter_tree` 注册的一切（dock/面板/自定义类型）必须在 `_exit_tree` 注销干净——卸载不干净是插件差评第一来源。
- 目录契约：`addons/<name>/plugin.cfg` + `@tool` 的 `plugin.gd`，目录自包含，不留 autoload。
- 编辑器 API（`EditorInterface` 等）绝不进运行时路径；`OS.has_feature("editor")` 分叉，导出构建不带编辑器代码。
- 经插件改用户场景/资源必须走 `UndoRedo`（do/undo 方法对）——不可撤销的场景编辑是数据事故。
- GDExtension 只在性能/复用 C++ 库时选；`.gdextension` 平台入口表 + API 版本对编辑器版本敏感，CI 按版本矩阵构建。

## 红线

- `@tool` 脚本加载即执行的副作用（打开任何工程都被动执行）。
- 插件逻辑与 EditorPlugin 壳混写（无法 headless 测试——可测逻辑抽纯模块）。
- 只编本机平台就发布 GDExtension（用户侧加载失败）。

## 深读指路（references/）

插件开发全文（EditorPlugin/自定义类型/导入器/GDExtension/发布卫生）：`references/addon-development.md`。
