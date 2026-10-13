# Nuxt 4（nuxt-framework）

> 来源：Nuxt 4 官方文档（目录结构/数据获取/服务端路由节）+ Nuxt Blog 版本要点；权威级：规范+建议
> 锚定版本：Nuxt 4（Nitro 2，Vue 3.5+） ｜ 核验日期：2026-10 ｜ 授权账本：`_sources.md`

## 目录结构（Nuxt 4 `app/` 形态）

```
app/
  pages/            # 文件路由（[id].vue 动态；layouts/ 布局壳）
  components/       # 自动注册（含嵌套目录前缀）
  composables/      # 自动导入
  layouts/  middleware/  plugins/  app.vue
server/
  api/              # 端点（defineEventHandler）
  middleware/  routes/  plugins/
shared/             # 前后端共享类型与工具
nuxt.config.ts  # 运行时配置与模块
```

- 约定内零注册（文件即路由/组件/composable）；`.nuxt/`、
  `.output/` 生成物不手改不提交。
- 迁移面（Nuxt 3 → 4 的 `app/` 重组）按官方迁移工具走，独立 PR。

## 数据获取（key 语义）

```ts
const { data, error, status, refresh } = await useFetch('/api/orders', {
  key: 'orders-list',
  query: { page },
  watch: [page],
})
```

- **key 是缓存身份**：同 key 复用载荷与去重——无 key（自动生成
  基于代码位置的 key 在条件分支下不稳）或随机 key 等于放弃缓存；
  查询参数变化进 `watch` 显式声明。
- `useFetch`（内置 `$fetch` 包装）/`useAsyncData`（任意异步）：
  `await` 顶层（Suspense 集成，服务端等数据）；客户端导航预取
  自动。
- 客户端专用获取：`lazy: true`（不阻塞导航）+ 骨架态；轮询用
  `refreshNuxtData`/定时面。
- 组件卸载后 refresh 取消守卫（`onScopeDispose` 中止）。

## server 面

```ts
// server/api/orders/[id].get.ts
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  return await db.orders.find(id)      // 服务端权威校验在此
})
```

- Nitro 端点：方法后缀（`.get.ts`/`.post.ts`）、`defineEventHandler`
  入口；`shared/` 类型两侧复用。
- **服务端是校验权威**（客户端校验只是体验——forms-validation）；
  鉴权/限流/输入 schema 校验（zod 谱系）在端点首行。
- `runtimeConfig`：私有键（server 可读）与 `public` 段（客户端）；
  环境覆盖 `NUXT_` 前缀。客户端代码读私有键在构建期就该报。

## 模块与插件

- 模块（`@pinia/nuxt`、`@vueuse/nuxt`）：`nuxt.config` 的
  `modules` 数组装即生效；版本与 Nuxt 版本矩阵核对。
- 插件（`app/plugins/`）：`defineNuxtPlugin` 注入应用级服务
  （provide 面与 `useNuxtApp().$x` 消费）；插件序显式 `order`。
- 中间件（`app/middleware/`）：路由级（命名中间件在页面
  `definePageMeta` 声明）——判定轻逻辑，同 router 守卫纪律
  （routing-patterns）。

## 渲染与部署

- 部署预设 `nitro.preset`（node-server/vercel/cloudflare…）；
  SSG（`nuxt generate` 或路由规则 `prerender`）；混合渲染按路由
  规则定模式（`routeRules: { '/admin/**': { ssr: false } }`）。
- ISR/缓存按托管面（`swr`/`isr` 路由规则）——渲染模式选型的取舍
  面（ssr-hydration 选型节）。

## 红线

- `useFetch` 无稳定 key；客户端读非 public 运行时配置。
- 手改 `.nuxt/`/`.output/`；server 端点不做输入校验直信客户端。
- 页面组件顶层 await 无 lazy 评估（整页卡数据）。
