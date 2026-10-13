---
name: vue-composables
description: 自写组合式函数纪律：useXxx 命名与返回 ref 集、setup 同步路径约束、清理成对（scope/卸载钩子）、异步 composable 的 loading/error 面、单例与共享。当抽取或评审 composable 时使用。触发词：composable、组合式函数、useXxx、逻辑复用、抽取 hook。
---

# 自写 composable（Vue 3）

composable 是 Vue 的逻辑复用单元：状态 + 派生 + 副作用打包成函数——但它活在组件生命周期的约束里，"看起来是普通函数"正是陷阱所在。

> **相关技能：** 容器选型（ref/watch） → `vue-composition`；现成工具库先查 → `vue-vueuse`；测试面 → `vue-testing`。

## 何时使用

抽取可复用逻辑、评审 composable 的正确性与复用性、设计共享状态 composable 时使用——动手前先查 VueUse（`vue-vueuse`），别重造库内已有的。

## 核心要点

- **形态纪律**：`useXxx` 命名；入参收 `MaybeRefOrGetter`（`toValue()` 归一）提升组合性；返回 ref/computed 集合（对象返回会被调用方解构——返回普通对象内装 ref 是安全的，解构后各 ref 仍响应；返回 `reactive` 整体则解构即断链）。
- **生命周期约束**：`onMounted`/`onWatch` 族必须在 setup 同步路径调用——composable 内条件调用是错误；需要懒注册的生命周期用 `tryOnMounted` 谱系（VueUse）或显式文档声明"仅 setup 内用"。
- **清理成对**：`watch`/`watchEffect` 返回的 stop、事件监听、定时器、ResizeObserver——要么 `onScopeDispose` 注册进当前 effectScope（组件卸载自动收），要么文档声明返回手动清理函数。
- **异步 composable 标准面**：`{ data, error, isLoading }` 三件套 + 可选 `refresh()`；顶层 `await` 会挂起组件（`<Suspense>` 域），默认非阻塞设计。
- **共享与单例**：模块级调用（组件外）用 `createGlobalState`/`createSharedComposable` 惯例（VueUse）；组件内每调用一份实例是默认语义——文档写清属于哪种。
- **纯逻辑不挂组件**：能不触碰 DOM/组件上下文的逻辑写成纯函数/纯 composable——可测性最好（`vue-testing` 的分层）。

## 红线

- 条件调用生命周期钩子；`useXxx` 却不返回响应式（伪 composable）。
- 副作用无清理路径（监听器/定时器泄漏）。
- 返回 `reactive` 整体令调用方解构断链。

## 深读指路（references/）

编写纪律与模式全谱：`references/composables-authoring.md`。
