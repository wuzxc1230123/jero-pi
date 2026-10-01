---
name: godot-signals
description: 信号与组的连接/断开/排障：Callable 连接、事件总线、CONNECT_DEFERRED、防 ObjectDB 泄漏。当连接信号、设计跨节点跨系统通信或排查信号泄漏时使用。触发词：信号、signal、connect、disconnect、事件总线、event bus、组、group、call_group、节点通信、解耦、lambda 泄漏。
---

# 信号、组与事件总线（Godot 4.x）

管"谁通知谁"：信号纪律与解耦配方。深度知识住模块 references（L2，路径经模块知识入口注入，按需读）。

> **相关技能：** 场景边界划分 → `godot-nodes-scenes`；GDScript 语言惯例 → `godot-gdscript`。

## 何时使用

信号与组的连接、设计、排障时使用；场景怎么拆、节点归谁管不归本技能管。

## 核心要点

- 连接用 Callable（`x.pressed.connect(_on_x)`），禁止字符串方法名连接（3.x 遗留）。
- 信号在状态变更**之后**发出；自定义信号带类型与足量上下文，监听者不回查发送者。
- lambda 连接必须可断开：存 Callable 成员并在 `_exit_tree` 断开，或 `CONNECT_ONE_SHOT`——否则 ObjectDB 泄漏。
- 物理回调（`body_entered` 等）里改场景树用 `CONNECT_DEFERRED`。
- 兄弟/跨系统通信走事件总线 autoload（广播事实，不携带命令）；批量寻址用组（`call_group` 无顺序保证）。
- `await signal` 只用于顺序流程（过场/回合），游戏循环里是隐藏耦合。

## 红线

- 信号在状态变更前发出（监听者读到半态）。
- 监听者长命、lambda 连接短命源且无断开——泄漏源。
- 总线信号带"命令某人做某事"语义（总线只广播事实）。

## 深读指路（references/）

信号/组/事件总线全文：`references/signals-groups.md`。
