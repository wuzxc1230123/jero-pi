---
name: godot-ui
description: 搭建游戏 UI/菜单/HUD、调锚点容器布局、做 Theme 与分辨率适配、焦点导航。当 Control 界面错位、适配断裂或焦点不可导航时使用。触发词：UI、界面、Control、容器、锚点、布局、主题、Theme、菜单、HUD、对话框布局、分辨率适配、UI 导航、焦点。
---

# UI 布局与主题（Godot 4.x）

管"界面怎么摆"：容器/锚点/Theme/适配配方与红线。深度知识住模块 references（L2，路径经模块知识入口注入，按需读）。

> **相关技能：** 对话内容系统 → 深读 `references/dialogue-narrative.md`；输入动作映射 → 深读 `references/input-actions.md`。

## 何时使用

搭建或修改 Control 界面（菜单/HUD/对话框）、调锚点容器、做 Theme 适配时使用；对话内容的数据结构不归本技能管。

## 核心要点

- 布局交给容器（VBox/HBox/Grid/Margin/Anchor）：手写坐标只在自绘特效，静态坐标布局是债。
- 锚点语义：锚 = 相对父级的比例参照；全矩形 UI 用锚 + margin/grow，不用绝对坐标。
- Theme 层级（项目默认 → 场景 → 节点覆盖）：颜色/字体/间距全部进 Theme 资源，散点 `add_theme_color_override` 只做局部例外。
- 分辨率适配开局钉：`canvas_items` 拉伸 + 基准分辨率 + `expanding` 行为；UI 安全区（notch）用 `get_display_safe_area`。
- UI 输入走焦点系统（`ui_*` 动作 + 焦点邻居），鼠标点击是补充不是唯一；手柄可导航是默认要求。

## 红线

- 业务数值/样式硬编码进 UI 脚本（数据走 Resource，样式走 Theme）。
- HUD 每帧 `get_node` 链刷新（缓存引用 + 信号驱动更新）。
- 全屏 UI 不暂停游戏却拦截不到输入（`process_mode` 与 mouse_filter 配置矛盾）。

## 深读指路（references/）

UI 布局与主题深知识：`references/ui-theming.md`；输入动作映射见 `references/input-actions.md`；对话系统见 `references/dialogue-narrative.md`。
