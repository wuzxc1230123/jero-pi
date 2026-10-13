---
name: godot-tilemap
description: 搭建瓦片地图与 TileSet、运行时读写格子：TileMapLayer 分层、瓦片自定义数据、单向平台、y-sort。当铺地形、配瓦片碰撞或改格子时使用。触发词：TileMap、TileMapLayer、瓦片、TileSet、地形绘制、Terrain、瓦片碰撞、格子、set_cell、单向平台、关卡地形、图层分层。
---

# 瓦片地图与关卡（Godot 4.x）

管"地形怎么铺"：TileMapLayer 配方与红线。深度知识住模块 references（L2，路径经模块知识入口注入，按需读）。

> **相关技能：** 碰撞层规划 → `godot-physics`；程序化铺图 → 深读 `references/procedural-gen.md`。

## 何时使用

搭建/修改瓦片地图与 TileSet、运行时读写格子时使用；关卡设计纪律在深读参考内，程序化生成不归本技能管。

## 核心要点

- 4.3+ 一个图层一个 `TileMapLayer` 节点（地形/装饰/伤害分层）；碰撞配在 TileSet 的 Physics Layer，不在图层节点。
- 坐标转换三段：global → local → map（`local_to_map(to_local(pos))`）；TileMapLayer 有变换时手除 tile_size 是错的。
- 玩法数值进瓦片自定义数据（Custom Data Layers：伤害值/摩擦/音效），脚本按数据读。
- 单向平台勾 One-way Collision；y-sort 遮挡把可遮挡层与角色放同一 y-sort 父级。
- 运行时改格子：空格判断（`get_cell_source_id == -1`）防重；批量改动攒一次 apply。

## 红线

- 老教程单 TileMap 多 layer API（4.x 已废）。
- 视口外瓦片手动物理分块（内置剔除已覆盖，自拆引入接缝 bug）。
- 每格碰撞单独 StaticBody2D 铺满地图（用 TileSet Physics Layer）。

## 深读指路（references/）

瓦片地图与关卡组织全文：`references/tilemap-levels.md`；碰撞层规划见 `references/physics-gameplay.md`；程序化生成见 `references/procedural-gen.md`。
