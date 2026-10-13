---
name: godot-jam
description: Jam 与快速原型工作流：可玩核心循环 > 完整系统、开工前定死范围、时间盒内只做减法。当参加 Game Jam、48 小时原型或需要极限裁剪范围时使用。触发词：game jam、48 小时、限时开发、原型、快速原型、范围裁剪、Ludum Dare。
---

# Jam 与快速原型（Godot 4.x）

管"时间盒内只做减法能赢的事"。深度知识住模块 references（L2，路径经模块知识入口注入，按需读）。

> **相关技能：** 品类最小系统清单 → `godot-genres`；三道门验证（jam 也要能跑）→ `godot-verify`；导出上传 itch → `godot-export`。

## 何时使用

参加 Jam、做限时原型、需要裁剪范围纪律时使用；正常开发的完整架构流程不归本技能管。

## 核心要点

- 目标：**可玩的核心循环 > 完整的系统**——判断口诀"砍掉它循环还成立吗"，成立就砍。
- 范围开工前 1 小时定死：一句话循环写下来贴住；与循环无关的想法进 `ideas-later.md` 不实现。
- 工程纪律 jam 期不豁免：`.godot/` gitignore、每可玩节点提交、提交前 `--headless --import` 过一遍（见 `godot-verify`）——jam 最后一小时工程崩了最冤。
- 预留导出时间盒：结束前 2 小时导出真实产物并启动验证（`godot-export`），"最后五分钟导出失败"是经典翻车。

## 红线

- 中途加"顺手做个新系统"（范围失控第一名）。
- 交付前没做过一次真实导出。
- 用"jam 结束再补"的理由跳过 git 提交与 import 检查。

## 深读指路（references/）

Jam 工作流全文（范围裁剪/时间盒/收尾清单）：`references/jam-prototyping.md`。
