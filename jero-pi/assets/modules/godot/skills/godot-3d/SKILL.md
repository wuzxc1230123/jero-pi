---
name: godot-3d
description: Godot 4 3D 开发基础：节点族与变换、glTF 模型导入、光照与全局 illumination 选型、3D 物理、LOD 与性能红线。当搭建 3D 项目、选光照方案、导入模型或排查 3D 性能时使用。触发词：3D、三维、Node3D、MeshInstance3D、网格、模型导入、glTF、光照、Light3D、Camera3D、3D 物理、CharacterBody3D、全局光照、烘焙、LOD。
---

# 3D 开发基础（Godot 4.x）

管 3D 项目搭建与基础选型：节点族、模型导入、光照方案、3D 物理、性能红线。深度知识住模块 references（L2，路径经模块知识入口注入，按需读）。

> **相关技能：** 着色器细节 → `godot-shaders`；2D 侧物理与移动 → `godot-physics` / `godot-2d-movement`。

## 何时使用

进入 Godot 4 3D 开发、做基础选型时使用；着色器编写与 2D 侧机制不归本技能管。

## 核心要点

- 变换用 `transform`/`look_at` 整体操作，不拆欧拉角手拼；`position` 局部、`global_position` 全局。
- glTF 2.0 为交换首选；模型比例错回 DCC 修（米制对米制），场景里 scale 硬补是债。
- 光照预算：移动端 LightmapGI（静态烘焙）+ 少量实时光；SDFGI/VoxelGI 属桌面档；点光阴影默认关。
- 物理同 2D 纪律（`physics-gameplay.md`）：CharacterBody3D 玩家、刚体信力；**ConcavePolygonShape3D 只给 StaticBody3D**。
- 中远景上 LOD（`visibility_range`）+ OccluderInstance；静态网格合并控制 draw call。

## 红线

- 运动体挂三角网格碰撞（物理引擎地雷）。
- 全场景点光全开阴影（性能悬崖不告警）。
- 未设 `visibility_range` 的装饰/粒子铺满全图。

## 深读指路（references/）

3D 基础全文（含 CharacterBody3D/FPS 控制器组合）：`references/3d-essentials.md`；摄像机跟随/震动/构图见 `references/camera-systems.md`；性能深读见 `references/performance.md`。
