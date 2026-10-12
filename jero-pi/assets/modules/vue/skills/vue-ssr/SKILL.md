---
name: vue-ssr
description: SSR/SSG 与水合：服务端渲染心智模型、水合不匹配（hydration mismatch）成因五态、窗口 API 守卫与 ClientOnly、状态序列化、SEO 与渲染模式选型。当开发 SSR 应用或排查水合警告时使用。触发词：SSR、SSG、水合、hydration、同构、服务端渲染、Nuxt。
---

# SSR 与水合（Vue 3）

SSR 是"服务端出首屏 HTML + 客户端接管"的两段式：服务端跑一遍组件（无 DOM/无窗口），客户端再跑一遍并接管（水合）——两遍不一致就是水合警告的根源。

> **相关技能：** Nuxt 框架落地 → `vue-nuxt`；浏览器 API 的库内守卫 → `vue-vueuse`；渲染模式选型 → `vue-architect`。

## 何时使用

开发/评审 SSR/SSG 应用、排查 hydration mismatch 警告、决定渲染模式（CSR/SSR/SSG/ISR）时使用。

## 核心要点

- **模式选型**：纯管理后台（登录后）用 CSR 足够；内容公开、SEO/首屏敏感用 SSR；内容静态用 SSG（构建期出 HTML）；高频变更内容 + CDN 缓存层谈 ISR（托管面支持时）。引入 SSR 是运维与复杂度决策（`vue-architect` 取舍面）。
- **水合不匹配五态**：①模板用了 `Date.now()`/`Math.random()` 等非确定值；②服务端与客户端时区/语言差异（`Intl`）；③窗口尺寸分支（服务端无窗口——`useWindowSize` 首帧服务端值固定）；④`v-if` 条件依赖 localStorage/cookie 客户端才有；③④类改 `<ClientOnly>` 包裹或 `onMounted` 后再取。⑤异步数据未在服务端 await（客户端先渲染空态后填充——flash）。
- **窗口 API 守卫**：`typeof window !== 'undefined'` 判定或 `onMounted` 内访问；`import.meta.browser`（Nuxt）语义等价；文档/导航器 API 同守卫纪律。
- **状态序列化**：SSR 状态经 `payload` 序列化进 HTML 再客户端水合（Nuxt 自动；手写 SSR 用 `renderToString` + `createPinia` 状态双跑同步）——序列化面必须可 JSON 化（函数/类实例不进状态）。
- **SEO 面**：`useHead`/`useSeoMeta`（Nuxt/unhead 谱系）声明式头管理；meta 随路由切换响应更新；OG 图与结构化数据在服务端可抓取。

## 红线

- 水合警告被忽略堆积（每条都是两遍渲染不一致的信号）。
- 服务端代码路径访问 `window`/`document`（异常即 500）。
- 不可序列化对象进 SSR 状态（水合断裂）。

## 深读指路（references/）

SSR 机制与水合排障全谱：`references/ssr-hydration.md`。
