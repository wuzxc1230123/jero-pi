# UI 布局与主题

Godot 的 Control 系统与常见 GUI 框架最大的差异：**容器驱动布局 +
主题继承链**。手写坐标是最大的反模式来源。

## 布局：交给容器，不写坐标

- 根 UI 用 `Control` 全屏锚点（Layout > Full Rect）；子元素进容器：
  `VBoxContainer`/`HBoxContainer`（线性）、`GridContainer`（网格）、
  `MarginContainer`/`CenterContainer`（定位）、`PanelContainer`（带底）。
- **绝不 `position = Vector2(...)` 摆 UI**（除拖拽类特例）：分辨率一变
  全错。锚点（anchors）定 Attachment，容器定排布，`size_flags` 定伸展。
- 响应式三件套：锚点预设（Layout 菜单）、`size_flags_horizontal/
  vertical`（FILL/EXPAND）、容器 `separation` 与主题默认间距。
- 动态列表（背包、任务）用 `VBoxContainer` + 实例化条目场景，配
  `ScrollContainer`；条目自身也是一个场景（复用与测试单元）。

## 主题：继承链上做覆盖

- Theme 资源沿树继承：节点未设主题样式时继承父级，最终到默认主题。
  **全局风格挂在场景根或 theme 自定义 autoload**，不在每个按钮上散改。
- 覆盖层级：theme 资源（全局）→ `theme_type_variation`（类型变体，
  如同款按钮的 danger 变体）→ 节点级 `add_theme_*_override`（只用于
  一次性特例）。散布的 override 是主题债，评审点名。
- StyleBoxFlat 圆角/边框/阴影做外观；颜色经 `StyleBoxFlat` 而非 `modulate`
  （后者连图标一起染色）。
- 字体：中文项目必须在主题级挂中文字体（Godot 内置字体不含 CJK）；
  动态字号用 `theme_override_font_sizes`，字号常量收进 Constants。

## 焦点与输入

- 手柄/键盘导航是 Control 的内建能力：`focus_mode` 保持默认（ALL 或
  CLICK 可选），`focus_neighbor` 默认按布局推；自定义导航例外写明。
- UI 吃输入用 `gui_input`，不抢 `_unhandled_input`；游戏热键在
  `_unhandled_input`（UI 优先消费后不再下传）。
- 弹窗用 `accepting` 型节点（`AcceptDialog` 系）或自制 + `get_viewport().
  set_input_as_handled()`；模态要挡住下层输入而非只盖住画面。
- 暂停菜单配 `get_tree().paused = true` + 节点 `process_mode =
  PROCESS_MODE_WHEN_PAUSED`（只给暂停 UI 开）。

## 中文本地化注意

- 字体覆盖（上文）；CSV/`Object.tr()` 做文案表：`tr("KEY")` + locale
  CSV。字符串硬编码在场景里的，评审按需提醒迁移。
- `Label` 自动换行 `autowrap_mode`；长文案容器给 `custom_minimum_size`
  下限，防溢出裁切。
- `LineEdit`/`TextEdit` 的 IME 在 4.x 可用，但 `secret` 模式与 IME 互斥
  ——密码框不做中文输入。
