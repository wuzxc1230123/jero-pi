# SSR 与水合（ssr-hydration）

> 来源：Vue 官方服务端渲染指南 + Nuxt 水合文档；权威级：规范+建议
> 锚定版本：Vue 3.5/3.6 + Nuxt 4 ｜ 核验日期：2026-10 ｜ 授权账本：`_sources.md`

## 心智模型

1. 服务端：跑组件 setup/render 出 HTML（无 DOM/无窗口/无交互）。
2. 客户端：加载 JS → 再跑一遍组件 → **水合**（把事件与状态接到
   已有 DOM 上，不重绘）。
3. 两遍输出不一致 → hydration mismatch 警告（DOM 修补但信号必须
   重视——每条都是"两遍逻辑分叉"）。

## 模式选型

| 模式 | 适用 | 成本 |
|---|---|---|
| CSR（Vite SPA） | 登录后台/内部工具 | 零 SSR 复杂度 |
| SSR | 公开内容、SEO/首屏敏感、逐用户动态 | 服务器运行时 + 水合纪律 |
| SSG | 内容静态（文档/营销页） | 构建期生成，无运行时 |
| ISR/混合 | 高频内容 + CDN（托管面支持） | 路由级模式矩阵 |

引入 SSR 是运维决策（服务器/缓存/监控面），不是纯前端决策——
取舍走 `vue-architect` 流程。

## 水合不匹配成因与解法

| # | 成因 | 解法 |
|---|---|---|
| 1 | `Date.now()`/`Math.random()`/`crypto.randomUUID()` 进模板 | 派生进 `onMounted` 后的客户端态；或种子化 |
| 2 | 时区/语言差异（`Intl`/`toLocaleString`） | 显式传 locale/timeZone；关键格式服务端注入 |
| 3 | 窗口尺寸分支（服务端无窗口） | `<ClientOnly>` 包裹；或 `useMediaQuery` 首帧默认态与 CSS 承接 |
| 4 | localStorage/cookie 客户端才有的分支 | `<ClientOnly>`；主题类进 cookie 服务端同读 |
| 5 | 异步数据服务端未等待（空态闪真态） | `await useFetch`（Suspense 面）；lazy 场景接受骨架态并显式 |

- 通用解法件：`<ClientOnly>`（Nuxt/组件库谱系）+ fallback 插槽；
  `onMounted` 内取客户端值；`useId`（3.5+）生成 SSR 稳定 id。

## 窗口 API 守卫

```ts
if (typeof window !== 'undefined') { … }   // 显式守卫
onMounted(() => { /* 客户端专属 */ })        // 钩子守卫
import.meta.browser                          // Nuxt 语境等价
```

- 服务端路径访问 `window`/`document`/`localStorage` 直接异常
  （500）；VueUse 核心函数自带守卫（vueuse-utilities SSR 节）。

## 状态序列化

- Nuxt：payload 自动（`useFetch` 数据 + Pinia 水合）——自定义
  payload 面按需（`payload:reduce` 瘦身）。
- 手写 SSR：`renderToString(app)` + `pinia.state.value` 序列化进
  HTML（`__INITIAL_STATE__`），客户端 createPinia 后回灌。
- 序列化面 JSON 可化：函数/类实例/循环引用不进状态（pinia-state
  红线同源）；大 payload 按需裁剪（列表只带首屏页）。

## SEO 与头管理

- `useHead`/`useSeoMeta`（unhead 谱系，Nuxt 内建）：声明式 title/
  meta/OG，路由切换响应更新，服务端可抓取。
- 结构化数据（JSON-LD）服务端注入；canonical/分页标签防重复内容。

## 性能与运维

- 水合成本 = JS 体积 × 组件数：懒水合（`LazyHydration` 谱系/交互
  触发）与 islands 谱系按需；流式 SSR（renderToStream）首字节提前。
- 服务器缓存层：页面级/组件级（`useAsyncData` key 去重 + Nitro
  缓存面）；TTL 与失效策略显式。
- 监控：水合耗时、SSR 错误率（error boundary + `onErrorCaptured`
  上报）。

## 红线

- 水合警告堆积不处理；服务端代码裸访问窗口 API。
- 不可序列化对象进 SSR 状态；逐用户数据进页面级缓存无键隔离。
