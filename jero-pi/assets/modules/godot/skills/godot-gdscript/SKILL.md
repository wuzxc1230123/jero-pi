---
name: godot-gdscript
description: GDScript 语言规范入口：类型注解、命名、注解顺序、typed 容器、静态纯函数与 NEVER 清单。当编写/评审 .gd 脚本、纠结命名/类型/注解惯例或排查 3.x 遗留写法时使用。触发词：GDScript 规范、GDScript 写法、脚本风格、类型注解、typed array、@onready、@export、静态函数、循环与容器写法。
---

# GDScript 语言规范（Godot 4.x）

管语言层面的"怎么写才对"：规范要点与红线。深度知识住模块 references（L2，路径经模块知识入口注入，按需读）。

> **相关技能：** 节点/场景组织 → `godot-nodes-scenes`；信号与通信 → `godot-signals`；C#/.NET 侧纪律 → 深读 `references/csharp-dotnet.md`。

## 何时使用

编写、修改或评审 GDScript 代码时使用；节点/场景/信号等引擎架构不归本技能管。

## 核心要点

- 公共 API（函数签名/成员变量）显式类型；局部用 `:=` 推断；容器类型化（`Array[Node2D]` 4.0+、`Dictionary[String, int]` 4.4+——低版本写类型化 Dictionary 直接语法错误）。
- 注解顺序：`@export` 前置工具注解 `@tool`/`@warning_ignore`；`@onready var x := $Path` 场景引用集中在类顶部。
- 命名：`snake_case` 函数与变量、`PascalCase` 类、`_` 前缀私有；信号过去式（`died`、`health_changed`）。
- `static func` 做纯函数（伤害公式/坐标换算），不触节点状态——可测性的来源。
- 字符串方法调用/`call()` 动态派发只在注册表场景使用，热路径禁止。

## 红线

- `var a = []`（未类型化容器）进公共接口。
- 3.x 遗留写法：`onready var`（无 @）、`export var`、字符串 `connect("x", self, "y")`。
- 热路径每帧 `get_node("...")` 字符串寻址（用 `@onready` 缓存）。

## 深读指路（references/）

规范全文与 NEVER 清单：`references/gdscript-style.md`；4.x API 陷阱与改名对照另见 `references/common-pitfalls.md`；C# 侧见 `references/csharp-dotnet.md`。
