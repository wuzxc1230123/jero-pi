---
name: vue-nuxt
description: Nuxt 4：约定路由与目录结构、useFetch/useAsyncData 数据获取（key 与去重）、服务端路由（server routes）全栈面、模块生态与水合（hydration）边界。当开发或评审 Nuxt 应用时使用。触发词：Nuxt、useFetch、useAsyncData、server routes、文件路由、nuxt.config。
---

# Nuxt 4（全栈框架）

Nuxt 是带服务端面的 Vue：文件路由即信息架构、数据获取有框架级缓存（key 语义）、server 目录是后端——约定吃掉配置，但约定没吃的必须懂机制。

> **相关技能：** 数据层与 store 的边界 → `vue-pinia`；SSR 水合机制 → `vue-ssr`；构建管线 → `vue-tooling`。

## 何时使用

开发/评审 Nuxt 应用（路由组织、数据获取、server 面、模块选型）时使用；纯 SPA 项目本技能不适用（Vite + Vue 即可）。

## 核心要点

- **目录约定（Nuxt 4 `app/` 结构）**：`app/pages/` 文件路由（动态 `[id].vue`、嵌套布局）、`app/components/` 自动注册、`app/composables/` 自动导入、`server/api/` 服务端端点——约定内的东西不手写注册。
- **数据获取**：`useFetch`/`useAsyncData` 带 **key**（缓存与去重的身份）——无 key 或随机 key 等于放弃缓存；`await` 顶层使用（Suspense 集成）；返回 `{ data, error, status, refresh }` 四件套；客户端导航预取自动。
- **服务端路由（server routes）**：`server/api/*.ts` Nitro 端点（`defineEventHandler`）；共享类型 `shared/` 目录两侧复用；服务端校验是权威（客户端校验只是体验——见 `vue-forms`）。
- **运行时配置**：`runtimeConfig`（`nuxt.config`）+ `useRuntimeConfig()`——私有键（不含 `NUXT_PUBLIC` 前缀）只在 server 可读；公开面 `public` 段。
- **模块生态**：`@pinia/nuxt`、`@vueuse/nuxt` 按需装；模块改动 `nuxt.config` 即生效——不手改 `.nuxt/` 生成物（生成物纪律同 runtime）。
- **水合边界**：`<ClientOnly>` 包纯浏览器组件；`onMounted` 内访问窗口 API；状态跨请求隔离靠框架（store 内不写模块级可变单例——同 `vue-pinia` 红线）。

## 红线

- `useFetch` 无稳定 key（缓存失效/重复请求）。
- 客户端代码读非 public 运行时配置（构建期就该拦）。
- 手改 `.nuxt/`、`.output/` 生成物。

## 深读指路（references/）

Nuxt 约定与数据获取全谱：`references/nuxt-framework.md`。
