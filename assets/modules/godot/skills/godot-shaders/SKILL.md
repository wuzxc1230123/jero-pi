---
name: godot-shaders
description: 编写/调试 gdshader 与 ShaderMaterial、做视觉特效（溶解/扭曲/描边/顶点动画/后处理）。当写着色器、配材质或特效性能存疑时使用。触发词：着色器、shader、gdshader、ShaderMaterial、材质、视觉效果、溶解、发光、扭曲、顶点动画、粒子材质、CanvasItem shader、Spatial shader。
---

# 着色器与视觉特效（Godot 4.x）

管"像素怎么算"：2D/3D 着色器配方与红线。深度知识住模块 references（L2，路径经模块知识入口注入，按需读）。

> **相关技能：** 3D 材质与光照 → `godot-3d`；性能预算 → 深读 `references/performance.md`。

## 何时使用

编写/调试 gdshader、配 ShaderMaterial、做视觉特效（溶解/扭曲/描边/顶点动画）时使用；后处理与整体画面风格调优见深读参考。

## 核心要点

- 2D 着色器改 `COLOR`（CanvasItem）；UV 原点左上、y 向下——与 3D（Spatial，UV y 向上语义差异）别混。
- 参数走 `shader_parameter` uniform（`@export` 热调），常量烧死在着色器里 = 设计不可调。
- 全屏后处理：`CanvasLayer` + `ColorRect` 全屏 + shader（屏幕纹理经 `uniform sampler2D screen_tex : hint_screen_texture` 采样——4.x 写法，3.x 的 `SCREEN_TEXTURE` 内建已移除）；移动端后处理是第一性能杀手，先预算后上。
- 时间 uniform 驱动动画（`TIME`）；帧相关效果用 `TIME * speed` 不用帧数。
- 粒子材质（ParticleProcessMaterial）与 GPUParticles2D/3D 配套；爆发型 `one_shot` + `restart()`。

## 红线

- 每帧新建 ShaderMaterial（材质实例化开销——共享 + 改参数）。
- 着色器里循环采样大纹理（移动端直接卡死）。
- 像素风项目默认过滤开的纹理上做像素完美 shader（UV 半像素偏移全糊）。

## 深读指路（references/）

着色器与视觉效果深知识：`references/shaders-visuals.md`；性能预算见 `references/performance.md`。
