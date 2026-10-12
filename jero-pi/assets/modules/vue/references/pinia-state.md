# Pinia 状态（pinia-state）

> 来源：Pinia 官方文档（核心概念/组合式 store/SSR/测试节）；权威级：规范
> 锚定版本：Pinia 3（Vue 3.5+ 配套） ｜ 核验日期：2026-10 ｜ 授权账本：`_sources.md`

## 形态：组合式 store 优先

```ts
export const useCartStore = defineStore('cart', () => {
  // state：可序列化数据源
  const items = ref<CartItem[]>([])
  // getter：派生
  const total = computed(() => items.value.reduce((s, i) => s + i.price * i.qty, 0))
  // action：变更与异步唯一入口
  async function add(sku: string) {
    const stock = await api.checkStock(sku)
    if (stock <= 0) throw new OutOfStockError(sku)
    items.value.push({ sku, qty: 1, price: await api.price(sku) })
  }
  return { items, total, add }
})
```

- setup 形态与组件同构（ref/computed/function），类型推导最优；
  选项式（state/getters/actions 对象）存量代码继续支持不重写。
- 消费：`const cart = useCartStore()`；**state/getter 解构必
  `storeToRefs(cart)`**，action 直接解构（`const { add } = cart`）。

## 切分与边界

- 按域切（`useCartStore`/`useUserStore`/`useUiStore`），不建
  "全局大 store"——切分线跟领域走不跟页面走。
- **不进 store 的三类**：组件本地 UI 态（`ref` 即可）、URL 可分享
  态（路由参数/查询——routing-patterns）、服务端缓存态
  （Nuxt `useFetch`/TanStack Query 谱系管理缓存生命周期，手写
  store 缓存是状态机负担）。
- 跨 store 组合：action 内 `useOtherStore()` 按需实例化；模块顶层
  互相调用成环——重构归属或延迟到 action 内取。

## 变更纪律

- 组件不直改 state（`cart.items.push(...)` 绕过 action）——审计
  断裂 + DevTools 时间线缺事件；变更走 action（action 内批量
  变更合并为一次历史记录）。
- `$patch` 批量（对象/函数式）用于确知的批量重置；
  `$reset`（setup store 3.x 支持需显式）回到初始。
- 表单草稿本地完成后 `action` 提交入库（不把表单中间态实时灌
  store——forms-validation 双源红线同源）。

## 异步与错误

- action async：错误是返回值域（`{ ok, error }` 形态）或内部捕获
  后置 `error` state——不裸 throw 进组件（组件只管展示态）。
- 加载态按请求粒度：`status`/`isLoading` ref 在 store 内，多个
  并发 action 各自的态分开命名。

## SSR 与水合（Nuxt）

- Nuxt（`@pinia/nuxt`）：每请求新 store 实例 + 状态序列化进
  payload 自动水合——**store 模块顶层不写可变单例**（跨请求泄漏）。
- 手写 SSR：服务端 `createPinia()` + 状态序列化（`pinia.state.value`）
  → 客户端 `createPinia()` + 同步初始态（进 hydration 流程，
  ssr-hydration）。
- 序列化面必须 JSON 可化：函数/类实例/Map（非空）不进 state。

## 持久化

- `pinia-plugin-persistedstate` 按需装；只持久化真正跨会话的子集
  （`pick: ['theme', 'locale']`）——购物车/草稿按业务定，令牌类
  敏感态走 httpOnly cookie 不进 localStorage（security-practices）。

## 测试

- `createTestingPinia({ stubActions: true })`：action stub 边界、
  state 直改模拟（测试域内合法）。
- 纯 store 逻辑（getter/同步 action）不挂组件直测：
  `setActivePinia(createPinia())` → `useCartStore()` → 断言。

## 红线

- 组件直改 state 绕过 action；解构 store 不用 `storeToRefs`。
- 组件复制 store 数据当本地态（双源漂移）。
- store 模块顶层可变单例（SSR 跨请求泄漏）。
