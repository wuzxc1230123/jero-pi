# 组合式 API（composition-api）

> 来源：Vue 官方指南（组合式 API/深入响应式/侦听器节）；权威级：规范
> 锚定版本：Vue 3.5/3.6 ｜ 核验日期：2026-10 ｜ 授权账本：`_sources.md`

## 容器选型决策树

```
这个值是什么？
├─ 原始状态（会被改）→ ref（默认）/ reactive（成组对象，勿解构勿替换）
├─ 派生值（纯计算）→ computed
├─ 副作用（DOM/请求/日志/订阅）→ watch / watchEffect
├─ 模板元素引用 → useTemplateRef('x')（3.5+）/ ref('x') 旧形态
└─ 一次性组织逻辑 → composable（composables-authoring）
```

## ref 与 reactive

- `ref` 一等公民：`.value` 一致性、可整体替换、解构安全（各 ref
  独立）、SSR 友好。
- `reactive` 收窄用途：成组强关联对象（表单模型/选项组）；**禁止
  解构**（断链，见 reactivity-deep）、**禁止整对象替换**、传入函数
  后失去类型联系。
- 转换工具：`toRef(obj, key)`/`toRefs(obj)`（reactive → ref 保链）；
  `toValue()`（ref/getter/裸值归一——composable 入参标准姿势）。

## computed

- 纯派生：无副作用、不改自身依赖；多消费者共享缓存（惰性求值 +
  依赖未变不重算）。
- 可写 computed（get/set 双函数）只用于"派生面 + 归一化写回"场景
  （全名 = first + last）。
- 模板内轻表达式与 computed 的取舍：重复消费/含计算量/需复用 → computed；
  一次性两元运算内联可。

## watch 族

```ts
watch(source, (val, oldVal) => { … }, { deep, immediate, once, flush })
watchEffect(() => { /* 自动收集依赖 */ })
```

- **选型**：需要旧值/显式控制依赖 → `watch`；副作用即依赖、立即
  执行 → `watchEffect`；精确到对象某属性 → `watch(() => obj.key)`。
- **source 形态**：ref（`.value` 自动）、getter、数组（多源并行）、
  reactive 对象（隐式 deep——显式声明更可读）。
- **选项**：`immediate`（首跑）、`deep`（深层，性能成本——能收窄
  到属性就不用）、`once`（单次）、`flush: 'post'`（DOM 更新后，
  DOM 测量类副作用）。
- **清理**：回调返回清理函数，或 `onWatcherCleanup(fn)`（3.5+）；
  句柄带 `stop`/`pause`/`resume`（3.5+）——轮询与竞态取消的标准件。
- **竞态**：异步回调里校验"我还是最新的吗"（序号/AbortController），
  慢响应覆盖快响应是经典 bug。

## 生命周期

- setup 同步路径注册：`onMounted`（取数/挂监听）、`onUnmounted`
  （清理）成对；`onBeforeUnmount` 做"卸载前必须完成"的动作。
- 错误与调试：`onErrorCaptured`（组件树错误拦截，配
  `errorCaptured` 返回 false 止传播）、`onRenderTracked`/
  `onRenderTriggered`（DevTools 调试重渲染）。
- `<Suspense>` + 顶层 `await`：异步 setup 挂起至 resolve——大面
  使用会卡首屏，默认非阻塞 composable。

## 红线

- watchEffect 内条件分支包依赖（依赖失收）；computed 内副作用。
- 深层 watch 滥用（能 `watch(() => obj.key)` 不 `deep: true`）。
- 异步竞态无序号/取消守卫。
