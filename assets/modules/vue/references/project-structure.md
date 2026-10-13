# 项目结构（project-structure）

> 来源：Vue 官方规模化指南 + create-vue 模板惯例 + 社区通行布局；权威级：建议
> 锚定版本：Vue 3.5/3.6 + create-vue ｜ 核验日期：2026-10 ｜ 授权账本：`_sources.md`

## 标准布局

```
src/
├─ components/          # 按域分组：components/orders/OrderCard.vue
├─ composables/         # useXxx 逻辑复用（可 auto-import）
├─ stores/              # Pinia 按域切（stores/cart.ts）
├─ router/              # 路由表 + 守卫（index.ts/routes.ts）
├─ api/                 # 请求层：端点封装 + 类型 + 错误归一
├─ types/               # 共享类型（含 ImportMetaEnv 补充）
├─ views/ 或 pages/     # 路由页面组件（薄）
├─ assets/  styles/     # 静态资源与全局样式（token/重置）
├─ utils/               # 纯函数工具（不返回响应式）
└─ auto-imports.d.ts  components.d.ts   # 生成物——提交进仓
```

- 页面组件**薄**：取数编排 + 布局装配；重逻辑下沉 composable/
  store——页面是组装层不是逻辑层。
- `components/` 按业务域分子目录；`Base*`/`App*` 基础件独立分组。
  禁 `common/`/`misc/` 万能桶（归属不清先问域）。

## api 层必有一层

```ts
// api/orders.ts
export async function fetchOrders(page: number): Promise<Page<Order>> {
  const res = await http.get('/orders', { params: { page } })
  return res.data
}
```

- 组件不散写 fetch/axios——端点/类型/错误归一/mock 替换点全收
  `api/`；拦截器（鉴权头/重试/错误码归一）在 http 实例一次装配。
- Nuxt 项目 server 面（`server/api`）+ 客户端 `$fetch` 封装同理
  （nuxt-framework）。

## auto-import 面

- `unplugin-auto-import`（Vue/VueUse/router API）+
  `unplugin-vue-components`（组件）——**生成的 d.ts 提交进仓**
  （类型面完整、评审可读、CI 不因生成漂移假红）。
- auto-import 白名单显式配置（`imports: ['vue', 'vue-router',
  '@vueuse/core']`）——不自定义乱导入面。
- 团队偏好显式 import 时关闭 auto-import（二选一钉死，不半开）。

## 别名与导入

- `@/` 钉 `src/`（vite.config + tsconfig paths 双侧同步）；深层
  相对路径（`../../..`）是坏味道。
- 跨域 import 从域公共出口进（`components/orders/index.ts`）不深
  挖内部文件——重构可动内部不动面。

## 测试与脚本布局

- `tests/unit/`（或与组件同目录 `*.spec.ts`——二选一钉死）；
  `tests/e2e/`（Playwright）分离。
- `package.json` 脚本语义化：`dev/build/preview/typecheck/lint/
  test`（`vitest run`）/`test:watch`——脚本名是团队契约。

## monorepo 面

- pnpm workspace：`apps/*`（应用）+ `packages/`（`ui`/`shared`/
  `config`）；共享包显式 `exports` 面与 peer 依赖（vue 外部化防
  双实例）。
- 抽包时机：三处以上复用 + 边界稳定——先目录后包，不为简历抽包。

## 环境与工具文件

- `.env`（提交，公开默认）/`.env.local`（gitignore）；
  `.editorconfig` + ESLint/Prettier 配置提交；`vercel.json`/
  `netlify.toml` 托管重写规则（SPA fallback）随仓。

## 红线

- `components/common` 万能桶；组件内散写 fetch。
- auto-import 生成 d.ts 被 gitignore；深层相对路径跨域乱 import。
- 页面组件塞满业务逻辑（组装层变逻辑层）。
