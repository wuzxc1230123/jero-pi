---
name: godot-game-feel
description: 游戏手感（Juice）：输入响应 + 反馈层级 + 时间 manipulated；打击感、squash/stretch、hitstop、屏幕震动分层，手感参数全部 @export 集中可调。当打磨打击感/反馈或"游戏感觉不够爽"时使用。触发词：手感、juice、打击感、反馈、hitstop、卡帧、squash、拉伸、屏幕震动、游戏不爽。
---

# 游戏手感 Juice 与反馈层级（Godot 4.x）

管"爽不爽"：手感 = 输入响应 + 反馈层级 + 时间 manipulated。深度知识住模块 references（L2，路径经模块知识入口注入，按需读）。

> **相关技能：** 移动手感三件套 → `godot-2d-movement`；镜头震动 → `godot-camera`；反馈音画 → `godot-audio` / `godot-animation`。

## 何时使用

打磨打击感/受击反馈/操作爽度、设计反馈层级时使用；移动参数本身（土狼时间/跳跃缓冲）归 `godot-2d-movement` 管。

## 核心要点

- 反馈分层（每档比上档强、成本递增）：音效 → 粒子/闪光 → squash/stretch → hitstop（时间冻结 ms 级）→ 屏幕震动/色差；**逐层加，每层可独立开关**。
- 所有手感参数 `@export` 化集中可调（hitstop 时长/震动强度/缩放幅度），禁止散落硬编码——打磨就是调参循环。
- 时间 manipulated：`Engine.time_scale` 全局慢动作、hitstop 用短暂 `time_scale = 0`（注意 UI/音频总线的连带影响）。
- 打击感三连：命中帧 hitstop + 受击 squash + 震动，同一帧触发；来源强度分档驱动幅度。

## 红线

- 反馈效果全开堆满（层级失去对比 = 全都白搭——层级就是对比）。
- 手感数值魔法数散落各脚本（调一次全仓找）。
- hitstop/慢动作后忘记恢复 time_scale（游戏永久慢动作）。

## 深读指路（references/）

手感全文（反馈层级表/参数配方/时间操作纪律）：`references/game-feel.md`。
