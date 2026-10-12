---
name: vue-reactivity
description: 响应式深水区：追踪原理与断链五态（解构/替换/props/异步 this/shallow）、toRefs/storeToRefs 解法、markRaw 与 shallow 选型、大对象性能。当排查"不更新"或评审响应式正确性时使用。触发词：响应式、不更新、断链、解构、toRefs、shallowRef、triggerRef、markRaw。
---

# 响应式深水区（Vue 3）

"改了怎么不更新"九成是断链：Proxy 只追踪被访问的属性路径——断在解构、断在替换、断在 props、断在快照。先懂追踪，再写状态。

> **相关技能：** 组合式 API 容器选型 → `vue-composition`；store 解构 → `vue-pinia`；性能面 → `vue-performance`。

## 何时使用

排查状态不更新/重复渲染、评审响应式正确性与性能形状、决定 shallow/markRaw 时使用。

## 核心要点

- **断链五态与解药**：①解构 `reactive`/store → `toRefs()`/`storeToRefs()`；②替换 `reactive` 整对象（`state = {...}` 丢响应）→ 用 `ref` 或 `Object.assign`；③改 `props` → 本地 `ref` 拷贝或 `defineModel`；④异步回调里读旧引用 → 模板/computed 消费 ref 本体；⑤`shallowRef` 深层变更 → `triggerRef()` 显式通知。
- **props 解构已安全（Vue 3.5+）**：`const { count } = defineProps()` 解构值保持响应式（编译器转换）——仅限 3.5+，低版本按旧纪律。
- **shallow 分层**：`shallowRef`/`shallowReactive` 只追踪顶层——大不可变数据（图表数据集/三方类实例）用 shallow + 整体替换；类实例进响应式系统前 `markRaw()`（跳过代理）。
- **`toRaw` 只读逃生**：取原始对象做三方库交互/相等比较，不用于绕过更新（改 raw 不触发）。
- **性能形状**：深层 `reactive` 大树全量追踪；热路径列数据 `shallowRef` + 替换；`computed` 链保持无副作用才可被缓存与复用。
- **effectScope**：composable 内成组创建的侦听器收进 `effectScope` 统一停止（框架在组件卸载时自动收集 scope）。

## 红线

- 解构 `reactive`/Pinia store 后抱怨"不更新"（结构性断链）。
- 深改 `shallowRef` 不 `triggerRef` 静默失效。
- 把三方类实例/Map 大集直接塞 `reactive`（代理开销与行为变异）。

## 深读指路（references/）

追踪原理与断链判定的完整谱系：`references/reactivity-deep.md`。
