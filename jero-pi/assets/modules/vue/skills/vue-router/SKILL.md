---
name: vue-router
description: Vue Router 4：路由即信息架构、动态参数与命名路由、守卫分层（全局/路由/组件）、数据预取放组件不放守卫、懒加载分块。当设计路由或评审守卫用法时使用。触发词：路由、router、vue-router、守卫、beforeEach、动态路由、懒加载。
---

# 路由（Vue Router 4）

路由是应用的信息架构：URL 是可分享的状态，守卫是准入判定不是数据层——两个定位错了，路由会变成绕不开的泥潭。

> **相关技能：** 状态边界（URL 也是状态） → `vue-pinia`；Nuxt 文件路由 → `vue-nuxt`；鉴权面 → `vue-security`。

## 何时使用

设计路由结构、评审守卫与数据加载位置、处理动态路由/嵌套布局时使用。

## 核心要点

- **历史模式**：`createWebHistory()`（HTML5 路径）为默认；`createWebHashHistory()` 只在无服务端重写能力的宿主（内嵌/纯静态）。服务端配置 fallback 到入口（部署经典坑）。
- **命名路由优先**：`router.push({ name: 'order', params: { id } })`——硬编码路径字符串对重构不友好；动态段 `:id` 配 `props: true` 让组件收 props 而非读 `$route`（组件与路由解耦）。
- **守卫三层**：全局 `beforeEach`（鉴权/埋点）、路由独享 `beforeEnter`（页级准入）、组件内 `beforeRouteLeave`（未保存拦截）——守卫只做判定返回/重定向，**不做数据加载**（长 IO 卡导航）。
- **数据预取放组件/composable**：`watch(() => route.params.id, load, { immediate: true })` 模式——失败可重试可展示态；参数变更复用组件时必 watch（不重走生命周期）。
- **懒加载**：`component: () => import('./views/Order.vue')` 路由级代码分割；分组 chunk（同页多路由同块）按体积策略。
- **路由元信息**：`meta: { requiresAuth: true, title: '...' }` 声明页属性，守卫统一消费——鉴权分支不散在每个守卫里。

## 红线

- 守卫里 await 长数据加载（导航卡死、无加载态）。
- 参数变化不 watch（复用组件首屏后不刷新）。
- 组件内硬编码路径跳转绕过命名路由。

## 深读指路（references/）

路由分层与守卫全谱：`references/routing-patterns.md`。
