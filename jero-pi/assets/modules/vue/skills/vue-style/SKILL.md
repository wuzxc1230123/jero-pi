---
name: vue-style
description: SFC 风格核心：单文件组件结构序、script setup 优先、属性排序惯例、模板表达式轻薄。当写 Vue 组件或评审 SFC 结构时使用。触发词：SFC、单文件组件、script setup、模板、风格、结构。
---

# SFC 风格核心（Vue 3）

管"组件是写给人读的"这条底线：SFC 三段结构稳定、模板逻辑轻薄、风格归工具（ESLint + Prettier），结构归人。

> **相关技能：** 组件命名 → `vue-naming`；组合式 API 用法 → `vue-composition`；验证格式纪律 → `vue-tester`。

## 何时使用

新建/重构单文件组件、评审 SFC 结构与模板复杂度时使用。格式归 ESLint/Prettier（`npm run lint`），本技能管结构决策。

## 核心要点

- **三段序**：`<script setup>` → `<template>` → `<style scoped>`；`<script setup>` 是默认形态（编译宏免导入、类型推导最优），具名导出的选项式只出现在遗留代码。
- **模板轻薄**：模板只做映射与分支——表达式超过约 3 个运算符或含方法调用链时提为 `computed`/方法；格式化逻辑放 `computed` 或过滤器函数，不放模板内联。
- **属性排序惯例**：指令（`v-for`/`v-if`）→ `ref` 绑定 → 其他 props → 事件（`@`）→ 内容（`v-slot`）；同标签属性超过约 7 个考虑多行与拆组件。
- **`v-if` 与 `v-for` 不同标签**：同标签优先级陷阱（Vue 3 中 `v-if` 先于 `v-for` 求值）——需要"过滤后判断"时提 `computed` 列表。
- **样式作用域**：默认 `scoped`；深度选择器 `:deep()` 窄用；全局样式集中在样式入口文件，不散装 `<style>` 无 scoped。
- **多根模板**：片段（fragment）合法，但属性透传（attrs）落到哪个根要想清楚——显式 `v-bind="$attrs"`。

## 红线

- 模板内联复杂表达式与副作用（模板里改状态）。
- `<style>` 无 scoped 的全局污染；被注释掉的模板块留存。
- 一个 SFC 塞三个以上职责（数据获取 + 复杂交互 + 展示混作一团）。

## 深读指路（references/）

SFC 结构与风格全文：`references/style-and-formatting.md`。
