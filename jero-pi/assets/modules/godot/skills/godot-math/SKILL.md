---
name: godot-math
description: 游戏数学基础：dot/cross 朝向与左右侧判定、lerp 家族与帧率无关插值（1-exp(-k·delta)）、lerp_angle 防跳变、弧度制与 wrapf、Transform 空间换算。当写朝向/转向/趋近/夹角逻辑或排查"转向反向/帧率不同手感不同"时使用。触发词：向量、点乘、叉乘、dot、cross、lerp、插值、角度、弧度、lerp_angle、move_toward、变换、normalize、数学。
---

# 游戏数学基础（Godot 4.x）

管"哪个 API 干哪件事"：别手写引擎已有的运算。深度知识住模块 references（L2，路径经模块知识入口注入，按需读）。

> **相关技能：** 移动手感（插值的应用面）→ `godot-2d-movement`；相机趋近 → `godot-camera`；RNG 可复现 → `godot-procgen`。

## 何时使用

写朝向/夹角/左右侧判定、速度趋近、空间换算，或排查转向跳变/帧率绑定时使用；物理模拟本身的数学不归本技能管。

## 核心要点

- 朝向/视野判定用 `dot`（同向半边）；2D 左右侧用 `cross` 的 z 符号——别手拼分量。
- 角度插值一律 `lerp_angle`（`lerp` 跨 ±π 绕整圈）；角度比较前 `wrapf` 收区间。
- 帧率无关趋近：`lerp(a, b, 1.0 - exp(-k * delta))` 或 `move_toward(v, d * delta)`；每帧固定 t 的 lerp 是帧率绑定写法。
- 空间换算用 `Transform` 乘法（`global_transform * p`），不手拆 position + rotated 拼装；`rotation` 与 `global_rotation` 别混。
- 2D 旋转 0 朝上（-Y 前向）——写视野锥/炮口前先统一前向约定。

## 红线

- atan2 求角差不 wrap（±π 跳变转向反向）。
- 角度用 `lerp`（用 `lerp_angle`）。
- 已归一化向量二次归一 / 零向量方向直接用（误差与除零）。

## 深读指路（references/）

数学全文（向量/插值表/角度/变换/随机纪律）：`references/math-essentials.md`。
