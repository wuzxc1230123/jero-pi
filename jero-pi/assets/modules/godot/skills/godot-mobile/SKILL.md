---
name: godot-mobile
description: 移动端开发：触屏事件与虚拟摇杆、移动性能预算、安全区与适配、退后台存档（PAUSED 通知）、Android/iOS 发布链与真机验证红线。当移植到手机、做触屏操作或发布移动端时使用。触发词：移动端、手机、Android、iOS、apk、触屏、虚拟摇杆、多点触控、安全区、刘海、退后台、真机。
---

# 移动端（Godot 4.x）

管"桌面思维切到移动纪律"：输入、预算、生命周期、发布链。深度知识住模块 references（L2，路径经模块知识入口注入，按需读）。

> **相关技能：** 性能预算（移动档收紧）→ `godot-performance`；UI 适配与容器 → `godot-ui`；导出预设 → `godot-export`；存档原子写 → `godot-save`。

## 何时使用

移植/立项移动端、做触屏交互、处理退后台、走商店发布时使用；桌面版功能本身不归本技能管。

## 核心要点

- 触屏走 `InputEventScreenTouch/Drag`（多点按 index 分手指），虚拟摇杆自绘 Control；**不用鼠标事件模拟**（合成双触发）。
- 移动 GPU 低一个量级：后处理是第一杀手；预算按移动端定，提供 30/60fps 档位防发热降频。
- 退后台即存档：`NOTIFICATION_APPLICATION_PAUSED` 触发原子写存档——移动系统随时杀后台。
- 适配：`canvas_items` 拉伸 + `get_display_safe_area()` 收边（打孔/刘海）；点击目标 ≥ 44pt 级。

## 红线

- 只在桌面/模拟器验证就发布移动端（性能/触控/签名/审核四处翻车）。
- 忽略 PAUSED 通知（后台被杀没存档）。
- Android keystore 无备份纪律（丢失 = 更新线断裂）。

## 深读指路（references/）

移动端全文（输入面/预算/生命周期/发布链）：`references/mobile-development.md`。
