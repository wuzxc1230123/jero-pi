---
name: godot-nodes-scenes
description: 设计/重构场景层级与节点树：场景即可复用单元、组合优于继承、autoload 边界、实例化纪律。当决定节点归属、拆分可复用单元或排查巨型场景时使用。触发词：场景组织、节点树、子场景、场景拆分、组合优于继承、场景接口、实例化、PackedScene、场景结构设计。
---

# 场景与节点组织（Godot 4.x）

管"节点怎么组合、场景怎么拆"：架构配方与红线。深度知识住模块 references（L2，路径经模块知识入口注入，按需读）。

> **相关技能：** 节点间通信 → `godot-signals`；GDScript 语言惯例 → `godot-gdscript`。

## 何时使用

设计/评审场景结构与节点树组织时使用；节点间通信机制与编辑器实时操作不归本技能管。

## 核心要点

- 场景 = 可复用功能单元：根节点脚本定义对外接口（`@export` 面 + 上行信号），内部子节点对外不可见。
- 组合优于继承：多态行为用子场景替换 + 接口约定，不用深层脚本继承链。
- 父子直调、子父信号、兄弟走总线（autoload 事件总线）——跨层 `get_parent().get_parent()` 是架构债。
- autoload 只放服务/状态/工具三类，不持有场景节点引用；数量超 ~7 个重新切分。
- 实例化边界：外部只 `instantiate()` + 配 `@export` + 监听信号，不伸进内部改子节点。

## 红线

- 外部代码直达场景内部子节点（`enemy.get_node("HealthBar")`）——封装破坏。
- 场景根脚本引用兄弟场景的内部结构（重命名即全炸）。
- 该拆的巨型"万能场景"（一个场景配千行脚本管全关卡）。

## 深读指路（references/）

场景架构深知识：`references/scene-architecture.md`；数据层配套见 `references/resources-data.md`；资源导入管线见 `references/asset-pipeline.md`；编辑器活会话见 `references/editor-live-session.md`。
