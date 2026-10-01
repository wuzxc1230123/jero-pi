---
name: godot-performance
description: 性能预算与反模式：先测量后优化、帧预算表、profiler/monitor 定位、draw call/物理/实例化热点、对象池。当游戏卡顿、掉帧或要做性能优化时使用。触发词：性能、优化、卡顿、掉帧、profiler、帧率、FPS、draw call、对象池、内存、瓶颈。
---

# 性能预算与反模式（Godot 4.x）

管"先给预算，再花预算"：性能是预算管理不是事后优化。深度知识住模块 references（L2，路径经模块知识入口注入，按需读）。

> **相关技能：** 三道门验证（含启动观察）→ `godot-verify`；着色器预算 → `godot-shaders`；3D LOD/光照 → `godot-3d`。

## 何时使用

游戏卡顿/掉帧要定位瓶颈、立项定性能预算、优化前找证据时使用；"我机器上流畅"式的无证据判断不归本技能认。

## 核心要点

- **先测量后优化**：Godot profiler（脚本）/monitor（引擎指标）拿数字，没有热点证据不动手。
- 预算起点（60FPS 帧 = 16.6ms）：逻辑全体 ≤4ms、渲染 ≤8ms、留给引擎与余量——预算表立项时写下来。
- 三大常见热点：每帧 `instantiate/find_child/字符串拼接`（改池化 + 缓存引用）；物理过载（碰撞形状/层规划）；draw call（合批/LOD/剔除）。
- 对象池：高频生成/销毁（子弹/特效）必池化；池上限显式声明，无上限生成是红线。
- 优化只在真实目标硬件上验证（移动端 ≠ 桌面），验证留证走 `godot-verify`。

## 红线

- 无 profiler 证据的"直觉优化"（改完不复测）。
- 每帧 instantiate 或 `get_node("...")` 字符串寻址（见 `godot-gdscript` 红线）。
- 对象无上限生成（内存与物理双双崩盘）。

## 深读指路（references/）

性能全文（预算表/逐类反模式/工具用法）：`references/performance.md`。
