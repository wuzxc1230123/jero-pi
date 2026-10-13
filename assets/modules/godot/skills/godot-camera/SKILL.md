---
name: godot-camera
description: 摄像机系统：Camera2D 跟随与平滑、边界限制、镜头震动、构图与聚焦、Camera3D 基础。当调跟随手感、做镜头震动/过场运镜或排查"镜头漂/卡边界"时使用。触发词：相机、摄像机、镜头、Camera2D、Camera3D、跟随、平滑、镜头震动、构图、运镜、聚焦。
---

# 摄像机系统（Godot 4.x）

管"怎么看"：跟随、震动、聚焦各有独立状态。深度知识住模块 references（L2，路径经模块知识入口注入，按需读）。

> **相关技能：** 手感三件套与反馈层级 → `godot-game-feel`、`godot-2d-movement`；过场演出 → `godot-animation`；3D 基础 → `godot-3d`。

## 何时使用

调相机跟随/平滑、做镜头震动、限制边界、过场运镜时使用；玩家移动本身归 `godot-2d-movement` 管。

## 核心要点

- 跟随、构图、震动、聚焦**各有独立状态**，禁止一个脚本糅在一起——震动器是独立节点/组件，不写进跟随逻辑。
- Camera2D 跟随：`position_smoothing` + `position_smoothing_speed` 起步；前瞻偏移（look-ahead）按移动方向加，参数 `@export` 可调。
- 边界用 `limit_left/right/top/bottom` 钉死，不靠手 clamp。
- 震动分层（受伤重、开枪轻）： trauma 模型（trauma² 映射幅度，随时间衰减），多源叠加取和封顶——不用随机数直接怼 offset。

## 红线

- 震动逻辑内联进跟随脚本（两套状态耦合，改一个炸一个）。
- `_process` 里手写 lerp 追玩家且无固定时间语义（帧率不同手感不同）。
- 过场运镜靠移动 Camera 节点 + 硬编码时长等待（用 Tween/`references/camera-systems.md` 运镜配方）。

## 深读指路（references/）

摄像机全文（跟随配方/震动模型/聚焦/构图）：`references/camera-systems.md`。
