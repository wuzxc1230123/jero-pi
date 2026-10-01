---
name: godot-2d-movement
description: 编写/调试 2D 角色控制器与移动手感：平台跳跃/俯视角移动、重力、斜坡、土狼时间、跳跃缓冲、可变跳高与手感参数。当角色下沉穿地板、is_on_floor 恒假、跳跃手感不稳或手感数值散落时使用。触发词：角色移动、玩家控制、2D 移动、跳跃、土狼时间、跳跃缓冲、可变跳高、CharacterBody2D、move_and_slide、重力、手感参数、加速度摩擦。
---

# 2D 角色移动（Godot 4.x）

管"角色怎么动得顺手"：移动控制器的正确配方与红线。深度知识住模块 references（L2，路径经模块知识入口注入，按需读）。

> **相关技能：** 物理系统全貌与碰撞层设计 → `godot-physics`；瓦片地形搭建 → `godot-tilemap`。

## 何时使用

编写/调试 2D 玩家或敌人移动控制器时使用；物理系统全貌、碰撞层规划不归本技能管。

## 核心要点

- `move_and_slide()` 前直接赋 `velocity`，内部已乘 delta——外部再乘 delta 是 BLOCKER 级双重积分。
- 4.x 重力用 `get_gravity()`（项目设置），不自造常量；计时器（土狼/缓冲）在固定步长累加。
- 手感三件套：土狼时间 ~0.1s、跳跃缓冲 ~0.12s、可变跳高（松键截断 `velocity.y`）。
- `is_on_floor()` 依赖上一次 `move_and_slide()` 的碰撞结果——读它必须在其后。
- 加速/摩擦/空中操控度分开 `@export`；`move_toward` 做速度趋近。
- 斜坡：`floor_snap_length`、`floor_max_angle`；顶头：`slide_on_ceiling`。

## 红线

- `position += velocity * delta` 手写积分（绕开物理回调）。
- 每帧重建 `Input` 轴读取混用 `_process` 与 `_physics_process`（手感抖动）。
- 手感数值散落硬编码（集中 `PlayerTuning` Resource）。

## 深读指路（references/）

正确配方与手感三件套：`references/physics-gameplay.md`（CharacterBody2D 节）；输入来源见 `references/input-actions.md`；打击反馈与手感层级见 `references/game-feel.md`。
