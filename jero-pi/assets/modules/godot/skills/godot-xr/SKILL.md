---
name: godot-xr
description: XR 开发（VR/AR，OpenXR）：XROrigin3D 骨架、相机控制权归玩家、舒适度纪律、双目渲染预算减半、桌面模拟与真机走查。当开发 VR/AR、接 OpenXR 或排查晕动/性能不达标时使用。触发词：XR、VR、AR、OpenXR、头显、虚拟现实、XROrigin3D、XRController3D、晕动、瞬移、一体机。
---

# XR 开发（Godot 4.x）

管"3D 的严格子集 + 舒适度即功能"。深度知识住模块 references（L2，路径经模块知识入口注入，按需读）。

> **相关技能：** 3D 基础 → `godot-3d`；性能预算（XR 再收紧一档）→ `godot-performance`；导出矩阵 → `godot-export`。

## 何时使用

做 VR/AR 项目、搭 XR 场景骨架、处理舒适度/XR 性能时使用；普通 3D 项目不归本技能管。

## 核心要点

- 骨架：`XROrigin3D` + `XRCamera3D` + `XRController3D`，世界用真实米制；**移动玩家 = 移 Origin**，XR 相机由系统驱动。
- 性能预算减半：双目渲染，90Hz ≈ 11ms 总预算——draw call/光照按 `godot-performance` 再收紧一档。
- 舒适度即功能：移动给玩家选择（瞬移/平滑转向），**绝不脚本夺镜头**；UI 跟头不跟世界。
- XR 是模块边界：`OS.has_feature("xr")` 分层隔离，桌面构建不带 XR 路径。

## 红线

- 脚本改 XR 相机姿态（晕动直通车）。
- 桌面模拟通过就宣布舒适度 OK（只有真人戴机能测）。
- 桌面渲染预算直接做 VR（立项就按 XR 预算做减法）。

## 深读指路（references/）

XR 全文（场景骨架/舒适度纪律/预算/测试策略）：`references/xr-development.md`。
