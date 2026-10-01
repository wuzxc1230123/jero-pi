---
name: godot-input
description: 输入系统：InputMap 动作抽象、键盘/手柄双绑、事件流、运行时重映射、UI 焦点联动。当接按键/手柄、做键位重映射或排查"输入不响应/双触发"时使用。触发词：输入、按键、键盘、手柄、InputMap、动作映射、键位、重映射、InputEvent、输入缓冲。
---

# 输入系统（Godot 4.x）

管"代码只认动作，永不认按键"。深度知识住模块 references（L2，路径经模块知识入口注入，按需读）。

> **相关技能：** UI 焦点导航 → `godot-ui`；移动手感消费输入 → `godot-2d-movement`；动作映射与 UI 联动 → 深读 `references/input-actions.md`。

## 何时使用

接输入、配 InputMap、做手柄支持、写重映射 UI 时使用；输入如何变成移动手感归 `godot-2d-movement` 管。

## 核心要点

- 铁律：**代码只认动作（action），永不认按键**——`Input.is_action_pressed("jump")`，物理键全部住在 InputMap。
- 每个动作同时绑键盘与手柄（`add_action`/项目设置）；手柄可玩是默认要求不是加分项。
- 运行时重映射：`action_remove_event`/`action_add_event` 改的是事件映射，持久化进设置存档（`godot-save`）。
- 动作语义分层：`jump` 与 `ui_accept` 分开——UI 焦点系统用 `ui_*` 家族，玩法动作用自定义名，别混用。

## 红线

- 代码里出现 `KEY_W`/`JOY_BUTTON_A` 等物理键判定（重映射即失效）。
- `_process` 里既 poll 输入又同时接 `_input` 事件回调双消费（双触发）。
- echo/repeat 语义不分（按住连发要显式处理，别靠系统重复事件）。

## 深读指路（references/）

输入全文（InputMap 组织/事件流/重映射/设备切换）：`references/input-actions.md`。
