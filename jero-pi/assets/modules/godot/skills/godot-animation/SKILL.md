---
name: godot-animation
description: 编写补间与关键帧动画、组织 AnimationPlayer/AnimationTree、连接逻辑状态与动画状态、编排过场演出。当动画与逻辑状态不同步、Tween 失效孤儿或过场演出失控时使用。触发词：动画、AnimationPlayer、Tween、补间、AnimationTree、状态机动画、动画状态、SpriteFrames、关键帧、过场演出。
---

# 动画与补间（Godot 4.x）

管"怎么动起来"：Tween/关键帧/动画状态机的正确配方与红线。深度知识住模块 references（L2，路径经模块知识入口注入，按需读）。

> **相关技能：** 逻辑状态机与架构选型 → `godot-nodes-scenes`；打击反馈类微动画的层级策略 → 深读 `references/game-feel.md`。

## 何时使用

补间/关键帧/动画状态机与演出编排时使用；打击反馈的层级策略不归本技能管。

## 核心要点

- Tween 用 `create_tween()` 属性补间（`set_trans/set_ease` 显式声明曲线）；持有 Tween 引用防孤儿（节点释放 tween 即失效——挂 `bind_node`）。
- 逻辑状态与动画状态单向驱动：逻辑态 → `AnimationTree` 参数（Travel/Blend）；动画回调（`animation_finished`）只通知，不反向写逻辑态。
- AnimationPlayer 管关键帧资产（一次性演出/过场）；AnimationTree 管运行时混合（走/跑/攻击 blend）。
- `await tween.finished` 与手动 kill 并存时先判有效性；重复触发先 `kill()` 旧 tween。
- SpriteFrames 帧动画命名进数据（`_play("idle")` 字符串统一常量表）。

## 红线

- `_process` 里手写插值模仿 tween（重复造轮且无曲线语义）。
- 动画播放完改逻辑状态（倒置驱动方向——状态机是唯一事实源）。
- 过场动画硬编码时长等待（`await timer` 与帧率绑定——用 `animation_finished` 信号）。

## 深读指路（references/）

动画深知识：`references/audio-animation.md` 动画节；状态机选型另见 `references/scene-architecture.md`；反馈层级见 `references/game-feel.md`。
