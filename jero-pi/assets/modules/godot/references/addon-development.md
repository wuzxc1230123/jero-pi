# 插件与编辑器扩展开发（Addons / GDExtension）

覆盖两条扩展路线：**EditorPlugin（GDScript 编辑器插件）**——加 dock、
Inspector 面板、自定义导入器、编辑器工具；**GDExtension（C++）**——性能
敏感或复用原生库的运行时扩展。选题口诀：改编辑器体验 → EditorPlugin；
跑得更快/接 C++ 库 → GDExtension；只是给游戏加功能 → 普通节点 + 子场景，
不配"插件"。

## EditorPlugin（GDScript 侧）

- **生命周期**：`_enter_tree()`/`_exit_tree()` 成对——注册的一切（dock、
  面板、Inspector 插件、导入器）必须在 `_exit_tree` 注销干净；插件被禁用
  或编辑器退出时跑的就是它。
- **目录契约**：`addons/<plugin_name>/plugin.cfg` + `plugin.gd`（`@tool`
  + `extends EditorPlugin`）；目录自包含，卸载 = 删目录，不留 autoload。
- **`@tool` 纪律**：编辑器侧脚本必须 `@tool` 才会在编辑器里跑；游戏逻辑
  与编辑器扩展分离——`EditorInterface` 等编辑器 API 绝不进运行时路径
  （`OS.has_feature("editor")` 分叉）。
- **撤销/重做**：经插件改用户场景/资源必须走 `UndoRedo` API（`commit_action`
  + do/undo 方法对），让用户 Ctrl+Z 得回去；直接改了不进撤销栈 = 数据
  事故。
- **自定义 dock/面板**：`add_control_to_dock()` / `add_control_to_bottom_panel()`
  成对出现，`_exit_tree` 里对应移除。

## 自定义类型与导入器

- `add_custom_type()` 让自己的类出现在节点创建面板（配图标）；退出时
  `remove_custom_type()`。
- 自定义资源格式：`ResourceFormatLoader/Saver` 子类注册进
  `ResourceLoader`/`ResourceSaver`——只在真有专有格式需求时用；优先
  普通 `Resource`（.tres）。
- 自定义导入器（`EditorImportPlugin`）针对引擎不认识的源格式；导入产物
  规则见 `asset-pipeline.md`（`.import` 伴生入库、`.godot/` 不入库）。

## GDExtension（C++ 侧）

- **何时选**：热路径（大量实体的原生计算）、复用既有 C/C++ 库、需要
  跨项目分发的二进制组件。**不选**的理由同样成立：构建链复杂度、平台
  矩阵编译、调试成本——先测 GDScript 版瓶颈再说（`performance.md`）。
- 结构：`gdextension/*.gdextension` 配置文件（平台入口表）+ 各平台
  `.dll/.so/.dylib`；`extension_api.json` 对 Godot 版本敏感——**API 版本
  与编辑器版本错位 = 加载即失败**，CI 里对每个目标版本矩阵构建。
- 注册的类与内置类同级暴露给引擎（可继承、可 Inspector 编辑）；内存
  语义自己管（RID/引用计数），遵守 `RefCounted`/`Object` 生命周期约定。

## 测试与发布卫生

- **插件逻辑 headless 可测**：把可测逻辑抽成不依赖 EditorPlugin 壳的
  纯 GDScript 模块，`EditorPlugin` 只做接线——三道门（`verification.md`）
  照跑；编辑器交互面用 `godot --headless --import` 至少验证插件脚本能
  解析加载。
- **plugin.cfg 版本化** + 变更记录；发布到 AssetLib 前确认 `addons/`
  内无绝对路径、无用户级配置残留。
- 提交卫生：编辑器插件启停会改 `project.godot` 的 `[editor_plugins]` 与
  `addons/`——评审时留意别把开发期插件误提交（同 `editor-live-session.md`
  的活会话纪律）。

## NEVER

- **NEVER `@tool` 脚本里写随场景加载即执行的副作用**（自动改场景/资源）：
  打开编辑器就跑 = 用户打开任何工程都被动执行；工具行为挂在显式按钮/
  菜单上。
- **NEVER 插件在 `_enter_tree` 里 autoload 化或注册后不在 `_exit_tree`
  撤销**——卸载不干净是插件差评第一来源。
- **NEVER 编辑器扩展代码与运行时游戏逻辑混在同一脚本**（`EditorInterface`
  泄进导出构建 = 崩溃）。
- **NEVER GDExtension 只在本机编一个平台就发布**——`.gdextension` 平台
  入口缺失时用户侧直接加载失败；CI 矩阵构建或明示支持范围。
- **NEVER 经插件绕过 UndoRedo 直接改用户文件**——不可撤销的场景编辑
  是数据事故。
