---
name: vue-directives
description: 指令用法：内置全集（v-bind/v-on/v-if/v-for/v-model/v-show/v-html 边界）、修饰符谱系、自定义指令的窄面（DOM 直操作）与注册形态、v-html 安全红线。当用内置指令或评估自定义指令时使用。触发词：指令、directive、v-if、v-for、v-model 修饰符、自定义指令、v-html。
---

# 指令（Vue 3）

指令是模板的动词：内置十余个覆盖声明式的绝大多数面，自定义指令只补"必须直操作 DOM"的最后一段——顺序反了就是把逻辑藏进指令的黑洞。

> **相关技能：** 模板结构与轻薄 → `vue-style`；组件契约优先于指令 → `vue-components`；v-html 红线 → `vue-security`。

## 何时使用

使用/评审内置指令与修饰符、评估是否需要自定义指令时使用。

## 核心要点

- **高频内置**：`v-bind`（`:`）单向绑定、`v-on`（`@`）事件、`v-if/v-else-if/v-else` 条件渲染、`v-show` display 切换、`v-for`（必带 `key`）、`v-model`（表单与组件双绑）、`v-html`（原始 HTML——安全红线见下）。
- **修饰符谱系**：事件 `.stop/.prevent/.self/.once/.passive`；按键 `.enter/.esc` 与组合 `.ctrl.enter`；`v-model` 的 `.lazy/.number/.trim`——修饰符让模板自述意图，代替手写包装函数。
- **`v-if` 与 `v-for` 分标签**：同标签求值序陷阱（`v-if` 先于 `v-for`）；过滤提 `computed`。
- **自定义指令窄面**：只有"对 DOM 元素的底层访问"才写指令（聚焦管理、权限移除、点击外部、进入动画钩子）；业务逻辑/状态/组件通信都不该进指令——那是 composable/组件的职责。
- **指令形态**：`const vFocus: Directive = { mounted(el, binding) { … } }`（`<script setup>` 内命名 `vXxx` 自动注册）；钩子 `created/beforeMount/mounted/beforeUpdate/updated/beforeUnmount/unmounted` 按需实现；对象字面量参数 `binding.value/modifiers/arg` 语义清晰。
- **`v-html` 红线**：只渲染可信静态内容或经 sanitize 的富文本——不可信输入直进 `v-html` 是 XSS 直通路（`vue-security`）。

## 红线

- 自定义指令里做状态管理与跨组件通信（职责错位）。
- `v-for` 无 `key`；`v-if`/`v-for` 同标签。
- 不可信内容进 `v-html` 无 sanitize。

## 深读指路（references/）

指令谱系与自定义边界：`references/directives-usage.md`。
