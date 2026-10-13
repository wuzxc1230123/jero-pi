---
name: godot-components
description: 组件模式：行为拆成可挂载子节点组件（Health/Hitbox/Movement），只管自己的事、上行靠信号下行靠方法、不横向直连兄弟，多态靠换组件不靠加深继承。当拆分角色/实体行为、建可复用组件或纠结继承层级时使用。触发词：组件、component、组合、HealthComponent、Hitbox、行为拆分、继承 vs 组合、实体架构、可复用行为。
---

# 组件模式（Godot 4.x）

管"组合优于继承的落地"。深度知识住模块 references（L2，路径经模块知识入口注入，按需读）。

> **相关技能：** 场景架构（本篇的上层纪律）→ `godot-nodes-scenes`；信号上行 → `godot-signals`；依赖装配 → 深读 `references/dependency-injection.md`。

## 何时使用

拆角色/实体行为成可复用单元、多个对象共享同一行为（血量/受击/背包）、继承链要加深到第二层时使用；单个对象的私有流程不配组件。

## 核心要点

- 组件契约三条：**只管自己的事；上行靠信号（died/damaged），下行靠方法（take_damage）；不横向直连兄弟**——横向交互经信号或经宿主装配接线。
- 装配只在宿主根脚本：`@export var health: HealthComponent`（4.1+ 节点引用导出）或 `_ready` 取一次缓存；组件不回查宿主。
- 多态 = 换组件实现（`EnemyBrain`/`PlayerBrain` 同接口），共享组件（Health/Hitbox）不动。
- 组件参数 `@export` 化；无共享状态的组件可 headless 直测——组件化的可测性红利。

## 红线

- 组件 `get_parent()` 干涉宿主（上行只有信号）。
- 万能组件（一个管血量+移动+背包——换汤不换药的巨型脚本）。
- 自建继承链超一层还在加深（该拆组件的时刻）。

## 深读指路（references/）

组件模式全文（契约/装配与发现/取舍线/测试）：`references/component-system.md`。
