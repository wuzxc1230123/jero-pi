---
name: godot-physics
description: 设计碰撞层与物理交互、选择物理节点类型（Character/Rigid/Static/Area）、排查物理行为。当刚体不听话、碰撞层混乱或物理回调出错时使用。触发词：物理系统、碰撞层、collision layer mask、刚体、RigidBody2D、Area2D、Area3D、力、冲量、apply_impulse、物理检测、射线、RayCast、传感器、物理回调。
---

# 物理与碰撞（Godot 4.x）

管"物理怎么用对"：碰撞体系、body 选型、刚体纪律的配方与红线。深度知识住模块 references（L2，路径经模块知识入口注入，按需读）。

> **相关技能：** 角色移动配方 → `godot-2d-movement`；3D 特有面 → `godot-3d`；瓦片碰撞 → `godot-tilemap`。

## 何时使用

设计碰撞层/物理交互、选择 body 类型（Character/Rigid/Static/Area）、排查物理行为时使用；角色手感调参不归本技能管。

## 核心要点

- 碰撞层开局命名（world/player/enemy/hazard/projectile/trigger…）：`collision_layer` = 我是什么，`collision_mask` = 我检测什么。
- 感知/触发用 `Area2D`（只发 overlap 信号），物理主体用 body；`body_entered` 入口先判组/层掩码再处理。
- 刚体信力不信位置：`apply_impulse`/施力/关节；绝不每帧 set position——要么纯 CharacterBody，要么信刚体。
- 物理回调里不 instantiate/改树/文件 IO（deferred 一律）。
- 唤醒/睡眠：静止堆叠靠 `sleeping` 零成本；传送 RigidBody 后 `sleeping = false`。

## 红线

- 每帧给 RigidBody 写 `position`/`linear_velocity` 以外的运动学量。
- 碰撞层未命名混用数字裸值（`collision_mask = 12` 无人知含义）。
- 用 Area 当物理主体（无重量无反弹）或用 body 做高频感知。

## 深读指路（references/）

物理全貌（碰撞层规划/刚体纪律/手感机制）：`references/physics-gameplay.md`。
