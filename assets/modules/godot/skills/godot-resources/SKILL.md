---
name: godot-resources
description: Resource 与数据驱动设计：自定义 Resource 类、玩法数值 .tres 化、数据层与代码分离、UID 与引用。当把数值/配置抽成数据、建自定义 Resource 或排查"改数据不改代码"时使用。触发词：Resource、资源、tres、res、数据驱动、自定义资源、数据层、export 变量、配置。
---

# Resource 与数据驱动（Godot 4.x）

管"数值住数据、代码只消费类型"。深度知识住模块 references（L2，路径经模块知识入口注入，按需读）。

> **相关技能：** 场景架构与 autoload 边界 → `godot-nodes-scenes`；GDScript 类型纪律 → `godot-gdscript`；数值入档 → `godot-save`。

## 何时使用

抽玩法数值/内容表、建自定义 Resource 类型、组织数据层时使用；场景怎么拆归 `godot-nodes-scenes` 管。

## 核心要点

- Godot 的数据 spine：玩法数值/内容表全部 `Resource` 化（`.tres`），代码只消费类型——调数值不改代码。
- 自定义 Resource：`class_name X extends Resource` + `@export` 字段；Inspector 直接可编辑、可 `.tres` 实例化入库。
- 静态内容（敌人表/关卡表）`.tres` 入库；运行时生成的数据内存构造，别乱写 `res://`。
- 引用语义记住是**共享**：同一 `.tres` 被多处 load 是同一实例，改它全联动——需要独立副本用 `duplicate()`。

## 红线

- 数值硬编码在场景脚本里（每次平衡性调整都是代码提交）。
- 运行时 `ResourceSaver` 往 `res://` 写数据（导出后只读，行为编辑器/产物两态）。
- 用 `Dictionary` 手搓"配置表"而不用类型化 Resource（无类型检查、无 Inspector）。

## 深读指路（references/）

数据驱动全文（自定义 Resource/内容表组织/UID 与引用语义）：`references/resources-data.md`。
