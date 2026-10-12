# 响应式深水区（reactivity-deep）

> 来源：Vue 官方深入响应式系统/FAQ；权威级：规范
> 锚定版本：Vue 3.5/3.6 ｜ 核验日期：2026-10 ｜ 授权账本：`_sources.md`

## 追踪模型

- `reactive` 是 Proxy：**读取时收集依赖，写入时触发更新**——只有
  被访问过的属性路径才被追踪；从未在模板/computed/watch 里读过的
  属性变更不触发任何更新。
- `ref` 是带 `.value` 访问器的盒子：`.value` 的读写即收集/触发；
  对象值内部再走 reactive 代理（深层默认开启）。
- 组件渲染、computed、watch 各自是"副作用"：依赖集决定它们何时
  重跑——断链本质是"依赖没有被收集"。

## 断链五态与解药

| # | 形态 | 现象 | 解药 |
|---|---|---|---|
| 1 | 解构 `reactive` | `const { x } = state` 后改 `state.x` 不更新视图 | `toRefs(state)` 解构；或改用 ref |
| 2 | 替换 `reactive` 整对象 | `state = { … }` 后全断 | 用 `ref` 包整对象；或 `Object.assign(state, patch)` |
| 3 | 改 props | 警告/不更新 | 本地 `ref` 拷贝派生；或 `defineModel` 双绑 |
| 4 | 存快照不存引用 | 把 `.value` 拍进普通变量后用 | 传 ref 本体；消费处 `.value`/模板直用 |
| 5 | shallow 深层变更 | `shallowRef` 深改无反应 | `triggerRef(shallow)` 显式通知；或整体替换 |

Pinia 同源：`store` 本体是 reactive——解构 state/getter 必
`storeToRefs(store)`（action 是普通函数，直接解构安全）。

## props 解构（3.5+ 语义）

- `const { count } = defineProps<{ count: number }>()`——编译器
  把解构转为访问 `props.count` 的 getter，**保持响应式**（旧版本
  直接断链，升级面见 upgrade-migrations）。
- 解构值用于触发 watch 时写 `() => props.count` 形态更明确；
  `defineModel` 与 props 解构并存时双绑面优先。

## shallow 与 markRaw

- `shallowRef`/`shallowReactive`：只追踪顶层——大数据集（图表
  数据/表格万行/三方实例容器）用它 + **整体替换**语义。
- `triggerRef(x)`：shallow 深层变更后的显式通知（批量改完喊一嗓）。
- `markRaw(obj)`：对象进响应式系统**永不代理**——三方类实例
  （Map/Set/类实例/图表对象）防代理开销与行为变异；标记后深层依然
  不追踪。
- `toRaw(x)`：读原始对象（传三方库/相等比较）——改 raw 不触发更
  新，不做绕过通道。

## 性能形状

- 深层 reactive 大树 = 每个被读属性路径都进依赖图——热路径列数据
  shallow + 替换。
- computed 链保持纯函数才可缓存；依赖巨树的 computed 一次失效全线
  重算——收窄依赖粒度。
- `effectScope()`：成组创建的 computed/watch 收进 scope，组件卸载
  统一停止（框架自动收集组件 scope；手写 composable 大批量侦听时
  显式用）。

## 排障工具

- DevTools 组件面板：高亮重渲染组件 + "为什么重渲染"依赖列表。
- `onRenderTriggered` 打断点看触发源。
- "不更新"排查序：先确认是 ref/reactive 哪种 → 查五态断链 → 再
  查异步竞态（更新了但被覆盖）。

## 红线

- 解构 reactive/store 不加 `toRefs`/`storeToRefs`。
- 深改 shallowRef 不 `triggerRef`；`toRaw` 改完期待视图更新。
- 大对象无脑深层 reactive（追踪开销与内存双输）。
