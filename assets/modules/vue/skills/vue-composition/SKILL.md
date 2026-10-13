---
name: vue-composition
description: 组合式 API 核心：ref/reactive 取舍、computed 缓存语义、watch 族选型（watch/watchEffect/once/深度）、生命周期钩子在 setup 中的纪律。当写 setup 逻辑或评审侦听器用法时使用。触发词：组合式 API、setup、ref、reactive、computed、watch、watchEffect、生命周期。
---

# 组合式 API 核心（Vue 3）

组合式 API 是"按逻辑关注点组织代码"的机制：ref/reactive 管状态，computed 管派生，watch 管副作用——选错容器是响应式断链与冗余渲染的共同源头。

> **相关技能：** 响应式深水区（断链/性能） → `vue-reactivity`；自写 composable → `vue-composables`；工具库加速 → `vue-vueuse`。

## 何时使用

编写 `<script setup>` 逻辑、选择状态/派生/侦听容器、评审 watch 用法时使用。

## 核心要点

- **ref 为默认**：`ref` 单值显式（`.value` 一致）、可整体替换、解构安全；`reactive` 只用于成组对象（表单/配置），且绝不解构、不整替换。
- **computed 只做派生**：无副作用、依赖追踪自动；模板内重复计算与 `computed` 的取舍——多消费者或重计算必 `computed`，一次性轻映射可内联。
- **watch 三形态**：`watch(source, cb)` 显式依赖（可拿旧值）；`watchEffect` 立即执行自动收集（依赖被条件分支短路是陷阱）；`watch(fn)` 精确到属性。深层对象 `deep: true`，首次即跑 `immediate: true`。
- **watch 纪律**：回调只做副作用（写状态去 `computed`）；清理用回调返回的清理函数或 `onWatcherCleanup`（Vue 3.5+）；可暂停场景用句柄 `pause/resume`（3.5+）。
- **生命周期**：`onMounted` 拉数据、`onUnmounted` 清理成对出现；`<Suspense>` 下异步 setup 与 `onErrorCaptured` 的边界要知道（顶层 await 即挂起）。
- **`defineAsyncComponent` + 顶层 `await`**：异步组件是代码分割手段，不是数据加载手段（数据归 composable/Nuxt 数据层）。

## 红线

- `watchEffect` 里条件分支包裹依赖（条件变化后依赖失收）。
- computed 内发请求/改自身依赖（副作用入派生）。
- `onMounted` 拉数据但 `onUnmounted` 不清侦听/定时器（泄漏配对缺失）。

## 深读指路（references/）

组合式 API 全谱与选型决策树：`references/composition-api.md`。
