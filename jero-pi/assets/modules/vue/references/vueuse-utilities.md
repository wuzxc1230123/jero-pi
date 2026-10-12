# VueUse 全谱与调用策略（vueuse-utilities）

> 来源：vue-skills-main 快照（VueUse Skills，serkodev，MIT）——需求域映射表与 AUTO/EXTERNAL/EXPLICIT_ONLY 调用策略为其方法论，函数谱系经 @vueuse/core 文档核对；权威级：建议
> 锚定版本：@vueuse/core 12/13（Vue 3.5+） ｜ 核验日期：2026-10 ｜ 授权账本：`_sources.md`

## 调用策略三档

| 档 | 语义 | 例 |
|---|---|---|
| `AUTO` | 匹配需求即用 | `useStorage`、`useEventListener`、`useClipboard` |
| `EXTERNAL` | 依赖三方包，项目已装才用；未装先问 | RxJS 族（`useObservable`）、`useFuse`（fuse.js） |
| `EXPLICIT_ONLY` | 用户点名才上 | 低频重器（`useDraggable` 拖拽编排类） |

用户指令与项目 `AGENTS.md` 可覆盖默认档——策略是缺省不是法律。

## 需求域速查表

| 需求域 | 高频函数 |
|---|---|
| 状态与存储 | `useStorage`/`useLocalStorage`/`useSessionStorage`、`useAsyncState`、`useToggle`、`useCounter`、`useLastChanged`、`useMemoize` |
| 全局与共享 | `createGlobalState`、`createInjectionState`、`createSharedComposable` |
| 元素与交互 | `useEventListener`、`useDraggable`、`useDropZone`、`useElementSize`、`useElementVisibility`、`useIntersectionObserver`、`useMutationObserver`、`useResizeObserver` |
| 指针与手势 | `useMouse`、`useMouseInElement`、`usePointer`、`useSwipe`、`onClickOutside`、`onLongPress`、`useMagicKeys` |
| 窗口与环境 | `useWindowSize`、`useWindowScroll`、`useMediaQuery`、`useBreakpoints`、`useOnline`、`useNetwork`、`useDocumentVisibility`、`useFullscreen` |
| 偏好与外观 | `useDark`、`useColorMode`、`usePreferredColorScheme`、`usePreferredReducedMotion`、`useTitle`、`useFavicon` |
| 传感器/硬件 | `useGeolocation`、`useDeviceMotion`、`useBattery`、`useClipboard`、`useShare`、`useWakeLock` |
| 异步与队列 | `useAsyncState`、`useAsyncQueue`、`useTimeoutPoll`、`useIntervalFn`、`useRafFn` |
| watch 变体 | `watchDebounced`、`watchThrottled`、`watchOnce`、`watchIgnorable`、`watchPausable`、`whenever`、`until` |
| ref 算子 | `refDebounced`、`refThrottled`、`refAutoReset`、`refDefault`、`syncRef`、`syncRefs` |
| 传感器进阶 | `useScroll`、`useInfiniteScroll`、`useVirtualList`、`useScrollLock`、`useTextSelection` |
| 网络/数据 | `useEventSource`、`useWebSocket`、`useWebWorker`/`useWebWorkerFn`、`useFetch`（fetch 包装，与全局拦截器关系注意） |

完整 230+ 函数谱系见上游 `references/`（快照内逐函数 Usage + 类型
声明，按需读——渐进披露设计，本模块钉住选型与纪律层）。

## 使用纪律

- **按需导入**：`import { useLocalStorage } from '@vueuse/core'`——
  tree-shaking；禁整库副作用导入。
- **SSR 兼容**：核心函数服务端安全（首帧返回默认值/不触窗口）；
  Nuxt 项目装 `@vueuse/nuxt` 模块（auto-import + 客户端守卫统一）。
- **替代判定**：主路径三行内的简单逻辑手写可；含清理/SSR/序列化/
  边角（storage 读写类型、监听器卸载、防抖取消）用库——库的价值
  在边角。重造库内已有能力且丢清理语义是评审 BLOCKER 候选。
- **版本与配置**：`@vueuse/core` 钉版本；`createGlobalState` 等
  工厂的行为在 SSR（跨请求隔离）下由 Nuxt 模块面保证。

## 组合示例

```ts
// 主题持久化 + 响应系统偏好
const isDark = useDark()
const toggleDark = useToggle(isDark)

// 搜索输入防抖（ref 算子 + watch 变体二选一）
const keyword = ref('')
const debounced = refDebounced(keyword, 300)
watch(debounced, search, { immediate: true })

// 跨组件共享的会话服务（注入式）
const [useProvideSession, useSession] = createInjectionState(useSessionService)
```

## 红线

- 未装三方依赖用 `EXTERNAL` 档函数；手写 `addEventListener` 忘清理
  当"轻量实现"。
- 虚拟列表手写（万行渲染）而不用 `useVirtualList`/组件库虚拟滚动。
- 把 VueUse 的 ref 算子与 watch 变体叠成天书（组合有度，语义要能
  一眼读完）。
