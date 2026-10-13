---
name: godot-localization
description: 本地化：用户文本一律 tr()、译文住翻译 CSV、locale 切换与回退、CJK 字体 fallback 链、带参文本格式化不拼接。当做多语言/翻译/切换语言或排查"方块字/语序错"时使用。触发词：本地化、多语言、翻译、tr、locale、语言切换、CSV、字体缺字、zh_CN、国际化、i18n。
---

# 本地化（Godot 4.x）

管"文案进翻译表，代码不认识语言"。深度知识住模块 references（L2，路径经模块知识入口注入，按需读）。

> **相关技能：** UI 排版弹性（译文长度差）→ `godot-ui`；对话文案数据层 → `godot-dialogue`；语言设置持久化 → `godot-save`。

## 何时使用

做多语言、接翻译表、切 locale、排查字体缺字/语序问题时使用；单语言项目的文本组织（tr 习惯）也归本技能管。

## 核心要点

- 用户可见文本一律 `tr()` 包裹；译文住 `translations/*.csv`（键 + 每 locale 一列），立项第一天就走 tr——发布前捡字符串是最贵的还债。
- 带参文本用格式化不拼接：`tr("%s gained %d") % [n, c]`——语序因语言而异。
- locale 是语言_地区（`zh_CN` ≠ `zh_TW`）；首启侦探 + 设置页显式选择，选择入存档。
- CJK 第一坑是字体：默认字体不含中文，配 **fallback 字体链**；缺字表现为方块不是报错。

## 红线

- 用户文本硬编码不 tr()。
- 运行时拼接翻译键（`tr("ITEM_" + x)`）。
- 译文差异写进代码 `if locale ==` 分支（差异住翻译表与资产）。

## 深读指路（references/）

本地化全文（翻译链路/locale 管理/字体排版/资产本地化）：`references/localization.md`。
