# VueUse 高频模式（vueuse-patterns）

> 来源：vue-skills-main 快照函数参考谱系（storage/事件/watch 族/虚拟列表等高频面）蒸馏；权威级：建议
> 锚定版本：@vueuse/core 12/13 ｜ 核验日期：2026-10 ｜ 授权账本：`_sources.md`

## 存储与持久化

```ts
const settings = useLocalStorage('app:settings', { theme: 'light', fontSize: 14 })
settings.value.theme = 'dark'          // 自动写回 + 跨标签页同步
```

- `useStorage` 族：类型化默认值（string/number/boolean/对象
  序列化自动）；`listenToStorageChanges` 跨标签同步默认开。
- 会话级换 `useSessionStorage`；大/异步面 `useStorageAsync`。
- 手写 `JSON.parse(localStorage.getItem(...))` 散装块是该换的
  信号——错误处理/序列化/同步全在边角。

## 事件监听（清理内建的标准件）

```ts
useEventListener(window, 'keydown', onKey)      // 组件卸载自动移除
useEventListener(el, 'click', handler, { passive: true })
```

- 自动 target 清理与 SSR 守卫；`onClickOutside(el, cb)` 是其
  组合封装（下拉关闭/弹窗外点）。
- 键盘组合：`useMagicKeys()`（`Ctrl+K` 快捷键面板）；
  `onKeyStroke('Escape', close)`。

## 防抖节流双族

```ts
// watch 面
watchDebounced(keyword, search, { debounce: 300 })
watchThrottled(scrollPos, save, { throttle: 500 })
// 函数面
const run = useDebounceFn(commit, 300)
// ref 面（派生值延迟）
const debouncedKeyword = refDebounced(keyword, 300)
```

- 三面同语义按形态选：观察量用 watch 族、回调触发用 `useDebounceFn`、
  下游消费延迟值用 ref 算子。
- `whenever(ready, load)`（条件满足即跑一次式监听）、`until(x).toBe(y)
  .then(...)`（等待态）替代手写轮询。

## 滚动与列表

```ts
const { y } = useScroll(el)
useInfiniteScroll(listEl, loadMore, { distance: 200 })
const { listProps, containerProps } = useVirtualList(items, { itemHeight: 48 })
```

- 无限滚动配分页加载态/终点态；`useScroll` 的 `directions` 做方向
  敏感 UI。
- `useVirtualList` 万行列表标准解——`containerProps`/`listProps`
  展开 onto 容器与内层；行高不齐用 `overscan` 与估算校准，或组件
  库虚拟滚动。
- `useScrollLock`（弹窗开时锁背景滚动）。

## 环境与偏好

```ts
const isDark = useDark()                        // 系统 + storage + class 联动
const isMobile = useMediaQuery('(max-width: 768px)')
const online = useOnline()
const visible = useDocumentVisibility()        // 切后台暂停轮询
```

- `useDark`/`useColorMode` 统一主题源（别再手写
  `document.documentElement.classList`）。
- `useBreakpoints(defineBreakpoints({ mobile: 0, tablet: 768 }))`
  断点语义化。
- 轮询类逻辑配 `useDocumentVisibility`（后台暂停）与
  `useOnline`（断网停）。

## 定时与帧

- `useIntervalFn(cb, 1000, { immediateCallback: false })`——自动
  清理的定时器（`pausable` 选项返回 pause/resume）。
- `useRafFn` 动画帧循环（canvas/拖影）；`useTimestamp` 响应式时钟。
- `useTimeoutPoll(fn, 1000)` 间隔轮询（完成后再计时——比裸
  setInterval 语义准）。

## 网络与工作线程

- `useWebSocket(url)`（自动重连选项 + 响应式消息流）；
  `useEventSource`（SSE）。
- 重 CPU 任务 `useWebWorkerFn(fn)`（worker 封装，promise 化）——
  主线程不卡 UI。

## 红线

- 手写裸 setInterval/addEventListener 实现"自动清理版"语义（漏清
  理路径）。
- 防抖节流混用于同一输入形成双重延迟（watch 族 + fn 族叠用）。
- 把 VueUse 组合链叠到无法一眼读出数据流（超过三层组合提中间
  composable）。
