---
name: vue-naming
description: 命名决策树：组件 PascalCase 多词、composable useXxx、props/emits camelCase、store useXxxStore、常量 SCREAMING_SNAKE 局部化。当命名组件/组合式函数/事件或评审命名一致性时使用。触发词：命名、组件名、composable 命名、useXxx、事件名。
---

# 命名（Vue 3）

名字是组件契约的第一文档：大小写表种类，前缀表用途，多词防与 HTML 元素及未来原生标签撞名。

> **相关技能：** SFC 结构 → `vue-style`；composable 编写纪律 → `vue-composables`；store 命名 → `vue-pinia`。

## 何时使用

命名组件/composable/store/事件/props，或评审命名一致性时使用。

## 核心要点

- **组件多词 PascalCase**：`TodoList.vue` 不是 `Todo.vue`（与原生元素撞名）也不是 `todo-list.vue`；SFC 文件名即组件名，导入路径自解释。
- **composable 一律 `useXxx`**：返回 ref/computed 的组合式函数 `useCart`、`useMousePosition`；非响应式纯工具函数不带 `use` 前缀（那是 `utils/` 的事）。
- **props/emits camelCase**：声明 `searchQuery`，模板 kebab-case 传入 `search-query`；emits 事件名用 kebab-case 监听配套（`@update:model-value`）与 camelCase 声明对齐。
- **v-model 参数名表语义**：`defineModel` 默认 `modelValue`，双绑面命名成对（`title` + `update:title`）。
- **store `useXxxStore`**：Pinia 组合式 store `useCartStore`；state 字段名词、action 动词开头（`fetchOrders`/`clearCart`）、getter 表派生（`activeItems`）。
- **目录即域**：`components/orders/OrderCard.vue` 按域分组；禁 `components/common/` 万能桶堆积（归属不清先问域，再问建层）。

## 红线

- 单词组件名（`Menu`/`Item`）与 HTML/未来原生标签撞名。
- composable 不返回响应式却带 `use` 前缀（误导调用方解构）。
- 同一概念多种拼法并存（`orderList`/`orders-list` 混用）。

## 深读指路（references/）

命名决策树与生态惯例全文：`references/naming-conventions.md`。
