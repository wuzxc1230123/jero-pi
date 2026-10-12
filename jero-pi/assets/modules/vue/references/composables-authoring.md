# 自写 composable（composables-authoring）

> 来源：Vue 官方指南（组合式函数常见问答）+ VueUse 源码惯例派生；权威级：规范+建议
> 锚定版本：Vue 3.5/3.6 ｜ 核验日期：2026-10 ｜ 授权账本：`_sources.md`

## 骨架

```ts
export function useMousePosition() {
  const x = ref(0)
  const y = ref(0)
  const update = (e: MouseEvent) => { x.value = e.clientX; y.value = e.clientY }
  useEventListener(window, 'mousemove', update)        // 清理内建
  return { x, y }                                       // ref 集合
}
```

- 命名 `useXxx`；入参与返回**全响应式**（ref/computed）。
- 入参收 `MaybeRefOrGetter<T>` + `toValue()` 归一——调用方传裸值、
  ref、getter 都对，组合性最强。
- 返回普通对象装 ref（解构安全——各 ref 独立响应）；**不返回
  reactive 整体**（调用方解构即断链，reactivity-deep 态一）。

## 生命周期约束

- `onMounted`/`onUnmounted` 等组件钩子**只能 setup 同步路径调用**
  ——composable 被条件调用（`if (x) { onMounted(…) }`）是错误，
  钩子注册拿不到当前实例。
- 可选懒生命周期用 `getCurrentInstance()` 判定或 VueUse 的
  `tryOnMounted`/`tryOnScopeDispose` 谱系。
- 异步初始化拆两段：同步返回 ref（初始值）+ 异步填充（`useAsyncState`
  形态），不顶层 await（挂起组件，Suspense 域之外不友好）。

## 清理纪律

- 每个 `addEventListener`/定时器/Observer/订阅都有对应清理：
  - 首选挂进当前 effectScope（`onScopeDispose(fn)`——组件卸载自动
    收，手写 composable 大批量侦听时 `effectScope()` 显式成组）。
  - 或返回 stop/dispose 函数交调用方（文档声明"手动清理"）。
- watch 清理：回调返回清理函数 / `onWatcherCleanup`（3.5+）；句柄
  stop。
- "库内已有带清理的"（`useEventListener`）不自写裸 addEventListener
  （vue-vueuse 替代判定）。

## 输入输出形态

```ts
export function useFetchUser(id: MaybeRefOrGetter<string>) {
  const userId = toRef(id)                    // 保持响应式联动
  const data = shallowRef<User | null>(null)
  const error = ref<Error | null>(null)
  const status = ref<'idle' | 'loading' | 'ready' | 'error'>('idle')
  async function load() { … }
  watch(userId, load, { immediate: true })
  return { data, error, status, refresh: load }
}
```

- 异步 composable 标准面：`{ data, error, status/isLoading,
  refresh }`——不 throw 进调用方（错误是状态不是异常路径）。
- 入参响应式联动：watch 源用 `toRef` 化的入参（props/外部 ref 变更
  自动重跑）。

## 共享语义（写清属于哪种）

| 形态 | 语义 | 手段 |
|---|---|---|
| 组件内 | 每次调用一份状态 | 默认（setup 里调用） |
| 全局单例 | 跨组件共享一份 | `createGlobalState(useXxx)` |
| 每树共享 | 每棵组件树一份 | `createInjectionState(useXxx)`（根 provide） |

- composable 文档/命名显式声明共享语义——调用方默认按"每次一份"
  理解。
- 组件外（路由守卫/纯 ts 模块）调用响应式 API：ref/computed/watch
  合法但无自动清理——配 effectScope 手动管理。

## 可测性

- 纯逻辑 composable（不触 DOM/组件钩子）直测：调用 → 断言 ref →
  `nextTick`。
- 触组件上下文的（生命周期/注入）用挂载壳或对应 VueUse 工厂封装。
- 时间与定时进 fake timers；网络进 mock 边界（testing-practices）。

## 红线

- 条件调用生命周期；副作用无清理路径；返回 reactive 整体。
- `useXxx` 不返回响应式（伪 composable）；共享语义未声明。
- 顶层 await 阻塞组件（无 Suspense 设计下）。
