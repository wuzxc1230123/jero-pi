---
name: vue-components
description: 组件契约：defineProps 类型化声明、defineEmits 事件上抛、defineModel 双绑、插槽与作用域插槽、透传边界。当设计组件接口或评审 props/事件用法时使用。触发词：组件、props、emits、defineProps、defineEmits、defineModel、插槽、slot、v-model。
---

# 组件契约（Vue 3）

组件是黑盒契约：props 进、事件出、插槽定制结构——父改子的唯一合法通道是 props，子影响父的唯一合法通道是事件。

> **相关技能：** 响应式边界（props 不可改） → `vue-reactivity`；跨层依赖注入 → `vue-provide-inject`；双绑表单 → `vue-forms`。

## 何时使用

设计新组件接口、评审 props/emits/v-model 用法、决定内容定制走插槽还是 props 时使用。

## 核心要点

- **defineProps 纯类型声明**：`defineProps<{ title: string; count?: number }>()`（运行时校验自动生成）；必填/默认值用 `withDefaults` 或解构默认值（3.5+）；props 是只读单向流——本地可变态用 `ref` 拷贝或 `defineModel`。
- **defineEmits 显式声明**：`defineEmits<{ (e: 'select', id: number): void }>()`（类型化签名优先）；事件携带载荷不携带"指令"（父决定做什么，子只报告发生了什么）。
- **defineModel（Vue 3.4+）**：双绑标准形——`const title = defineModel<string>('title')` 直接可读可写，取代手写 `modelValue` + `update:modelValue` 样板；多个 v-model 各自命名。
- **插槽分层**：默认插槽管主体；具名插槽分区；作用域插槽把子数据回传父定制（列表项渲染权交出）；插槽 props camelCase。
- **透传边界**：未声明 props/attrs 自动落到根元素（`$attrs`）——多根或不想透传时显式 `v-bind="$attrs"` 或 `inheritAttrs: false` + 定向绑定；`class`/`style` 合并透传是惯例。
- **动态组件**：`<component :is="...">` 接组件对象或已注册名；用户输入直接拼组件名是注入面（安全红线见 `vue-security`）。

## 红线

- 子组件改 `props`（含对象属性深层改——变异 props 破坏单向流）。
- 未声明的 emits 静默触发（契约外的隐式接口）。
- 事件名与载荷语义不符（`@save` 却不带也不执行保存的语义）。

## 深读指路（references/）

props/emits/slots/v-model 契约全谱：`references/component-contracts.md`。
