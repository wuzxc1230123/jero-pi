---
name: vue-pinia
description: Pinia 状态管理：组合式 store 优先、state/getter/action 分面、storeToRefs 解构、跨 store 组合与循环依赖、持久化边界与测试面。当设计或评审全局状态时使用。触发词：Pinia、store、useXxxStore、storeToRefs、状态管理、全局状态。
---

# 状态管理（Pinia）

全局状态是显式契约：store 按域切分、组合式形态、解构走 `storeToRefs`——"什么都往 store 塞"与"组件里复制状态"是它的两大腐化方向。

> **相关技能：** 状态三级判定（本地/注入/全局） → `vue-architect`；响应式解构原理 → `vue-reactivity`；路由状态 → `vue-router`。

## 何时使用

设计/评审 store 切分与形态、处理跨组件状态共享、排查 store 相关响应式问题时使用。

## 核心要点

- **组合式 store 优先**：`defineStore('cart', () => { const items = ref([]); …; return { items, add } })`（setup 形态）——ref/computed/function 与组件同构，类型推导最优；选项式形态只在存量代码。
- **分面纪律**：state 只放可序列化数据源；getter 是派生（computed）；action 是变更与异步的唯一入口（组件不直接改 state——DevTools 追踪与审计面）。
- **解构必 `storeToRefs`**：`const { items } = storeToRefs(store)` 保响应式；action 直接从 store 解构（函数无响应性问题）——两种解构两种来源，混用是经典断链。
- **跨 store 组合**：action 内调用其他 store（`useOtherStore()` 在 action 里按需实例化）；模块顶层互相调用是循环依赖——重构归属或延迟获取。
- **边界**：URL 可分享态归路由（`vue-router`）；服务端缓存态归数据层（Nuxt `useFetch`/Query 谱系）——塞进 store 的缓存是手写状态机负担；持久化（`pinia-plugin-persistedstate`）只钉真正跨会话的子集。
- **SSR 面**：Nuxt 下 store 状态序列化水合自动；跨请求状态泄漏防在"模块级单例"——store 内不写模块级可变变量。

## 红线

- 组件里复制 store 数据当本地态（双源漂移）。
- 直接改 state 绕过 action（审计断裂）。
- 解构 store 不用 `storeToRefs`（断链）。

## 深读指路（references/）

store 设计与组合全谱：`references/pinia-state.md`。
