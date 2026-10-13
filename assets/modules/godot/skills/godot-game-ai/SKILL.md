---
name: godot-game-ai
description: 游戏 AI：决策与执行分离、状态机/行为树/Utility 选型、感知（视野/听力）、寻路与 NavigationAgent。当做敌人 AI、同伴行为、寻路或排查"AI 卡墙/全体同质"时使用。触发词：敌人 AI、行为树、状态机、AI 决策、Utility AI、感知、视野、寻路、导航、NavigationAgent、NavigationServer、追击。
---

# 游戏 AI（Godot 4.x）

管"决定做什么，与怎么动分开"。深度知识住模块 references（L2，路径经模块知识入口注入，按需读）。

> **相关技能：** 移动执行 → `godot-2d-movement` / `godot-physics`；能力与冷却 → 深读 `references/ability-system.md`；决策层可测性 → `godot-verify`。

## 何时使用

做敌人/同伴/NPC 行为、选 AI 架构、写感知与寻路时使用；"AI 生成内容"类话题不归本技能管。

## 核心要点

- 分层铁律：**决策（做什么）与执行（怎么动）分离**——决策层零引擎依赖，可 headless 直测（见 `references/testing.md`）。
- 选型阶梯：枚举状态机（默认起点）→ 行为树（行为多/可组合）→ Utility（权衡多目标）；别跳级，状态机撑得住就别上树。
- 感知独立成组件：视野（射线 + 视锥）、听力（事件广播半径）；感知结果（看见谁）经信号喂决策层，决策不直接查场景。
- 寻路走 `NavigationAgent2D/3D` + NavigationRegion 烘焙（`bake` 是显式动作，运行时开销注意）；随机巡逻点预生成，不每帧采样。

## 红线

- 决策逻辑写进 `CharacterBody` 移动脚本（两套关注点纠缠，不可测）。
- 每帧全量 AI tick（分帧/节流，感知低频决策低频只有执行高频）。
- 手写 A* 或直线 `move_toward` 当寻路（卡墙是必然——NavigationServer 已内置）。

## 深读指路（references/）

游戏 AI 全文（状态机/行为树/Utility/感知/寻路配方）：`references/game-ai.md`。
