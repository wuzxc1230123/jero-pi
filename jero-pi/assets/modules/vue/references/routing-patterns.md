# 路由（routing-patterns）

> 来源：Vue Router 4 官方文档（动态路由/导航守卫/懒加载节）；权威级：规范
> 锚定版本：Vue Router 4.5+ ｜ 核验日期：2026-10 ｜ 授权账本：`_sources.md`

## 基础形态

```ts
const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/orders/:orderId', name: 'OrderDetail',
      component: () => import('@/views/OrderDetail.vue'),
      props: true, meta: { requiresAuth: true } },
  ],
})
```

- `createWebHistory()` 默认（部署需服务端 fallback 到入口——
  nginx `try_files` / 托管平台重写规则）；hash 模式只在内嵌/纯静态
  宿主。
- 命名路由 + `props: true`：组件收 `orderId` prop 而非读
  `$route`——组件与路由解耦（可挂载直测）。

## 结构分层

- **路由即信息架构**：路径段表资源层级（`/orders/:id/items/:itemId`）；
  命名路由全局唯一；重定向/别名（`redirect`/`alias`）在表内声明。
- 嵌套与布局：`children` + 空 path 父组件作布局壳；`<RouterView>`
  承接；多视图命名视图（`components: { default, sidebar }`）。
- 路由元信息 `meta`：`requiresAuth`/`title`/`roles` 页属性声明，
  守卫统一消费——鉴权分支不散装。

## 守卫三层（判定不取数）

```ts
router.beforeEach((to) => {                     // 全局：鉴权/埋点
  if (to.meta.requiresAuth && !auth.ready.value)
    return { name: 'Login', query: { redirect: to.fullPath } }
})
// 路由独享 beforeEnter：页级准入
// 组件内 onBeforeRouteLeave：未保存拦截
```

- 守卫返回 `true`/`false`/路由地址/`Error`——不做数据加载（长 IO
  卡导航无加载态）；数据预取放组件/composable。
- `onBeforeRouteUpdate`：参数变更复用组件时按需响应（配 watch 形态
  二选一，别双轨）。

## 数据预取模式

```ts
// 组件内：参数驱动加载
watch(() => route.params.orderId, load, { immediate: true })
```

- `immediate` 必带（首屏进入不触发 watch 的经典坑）。
- 加载态/错误态是组件渲染面（骨架/错误重试）；离开页面取消在途
  请求（AbortController + unmounted 清理）。
- Nuxt 下数据预取走 `useFetch`/`useAsyncData`（框架级 key 缓存与
  客户端预取，nuxt-framework）。

## 懒加载与分块

- 路由级 `() => import()` 默认（每个页面一个 chunk）；首屏首路由
  可配 preload。
- 同域多路由分组块（`import()` 注释 webpackChunkName 谱系/Rollup
  manualChunks——vite-toolchain）。
- 重组件（图表/编辑器）二次懒加载（交互触发 `defineAsyncComponent`
  + loading 态）。

## 组合式 API 面

- `useRoute()`/`useRouter()` 在 setup 取（不 import 实例单例——
  测试可替换）；`useLink` 自定义链接组件。
- query/params 是响应式的：`watch(() => route.query.q, …)` 搜索
  面同步 URL 状态（URL 也是状态——分享/后退可用）。

## 红线

- 守卫内 await 数据加载；参数变更不 watch/immediate 缺失。
- 组件深读 `$route` 解耦缺失（props 化不做）。
- 硬编码路径字符串跳转绕过命名路由；循环重定向无守卫出口。
