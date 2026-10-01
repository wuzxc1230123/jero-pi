---
name: godot-genres
description: 玩法类型组合配方：每类 = 核心循环 + 最小系统清单 + Godot 落地选型 + 特有坑（横版/roguelike/塔防/RPG/生存等）。当选品类、定最小系统范围或查该类型特有坑时使用。触发词：平台跳跃、横版、roguelike、塔防、RPG、生存、卡牌、视觉小说、品类、做什么类型、游戏类型。
---

# 玩法类型组合配方（Godot 4.x）

管"怎么拼"：配方不复授原语，前置件是各领域技能。深度知识住模块 references（L2，路径经模块知识入口注入，按需读）。

> **相关技能：** 原语层——移动 `godot-2d-movement`、物理 `godot-physics`、数据 `godot-resources`、生成 `godot-procgen`、存档 `godot-save`；本技能只讲组合。

## 何时使用

选品类、按品类定最小系统清单、查某类型的 Godot 落地选型与特有坑时使用；单个系统怎么实现归对应领域技能管。

## 核心要点

- 每类配方四件套：**核心循环（一句话）+ 最小系统清单 + Godot 选型 + 特有坑**——先循环后系统，循环不成立系统白搭。
- 品类间大量复用同一批前置件（平台跳跃与 roguelike 都吃移动/生成/存档）——配方给"拼法"与"顺序"，不重复教原语。
- 选型示例：塔防（TileMap 摆位 + NavigationAgent 寻路 + 数据表驱动敌人波次）、卡牌（Resource 卡牌定义 + 状态效果台账）。
- 特有坑按品类记录（如 roguelike 的"生成可复现"、视觉小说的"文案量爆炸"）——立项时先读对应节再排期。

## 红线

- 按配方全量铺系统不做循环验证（先核心循环可玩，再逐系统加）。
- 拿配方当教程抄原语实现（原语走领域技能与 references，配方只管组合）。

## 深读指路（references/）

品类配方全文（逐类循环/系统清单/选型/坑）：`references/genres-recipes.md`；Jam 期裁剪纪律另见 `references/jam-prototyping.md`。
