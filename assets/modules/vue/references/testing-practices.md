# 测试实践（testing-practices）

> 来源：Vitest + Vue Test Utils 官方文档；权威级：建议
> 锚定版本：Vitest 3 + @vue/test-utils 2 ｜ 核验日期：2026-10 ｜ 授权账本：`_sources.md`

## 分层策略

| 层 | 对象 | 工具 | 量级 |
|---|---|---|---|
| 纯逻辑 | composable/工具函数 | Vitest 直测 | 底座（多数） |
| 组件契约 | props/emits/插槽渲染 | Vue Test Utils | 中层 |
| 集成 | 路由+store+组件树 | mount + 测试插件 | 窄面 |
| E2E | 关键路径 | Playwright | 冒烟级 |

## composable 直测

```ts
it('useCounter 递增', () => {
  const { count, increment } = useCounter()
  increment(); increment()
  expect(count.value).toBe(2)
})
it('侦听联动', async () => {
  const { x, doubled } = useDoubler(ref(1))
  x.value = 5
  await nextTick()
  expect(doubled.value).toBe(10)
})
```

- 触组件上下文的 composable：`withSetup`（挂一次性壳）或改设计
  （composables-authoring 的可测性面）。

## 组件挂载

```ts
const wrapper = mount(OrderCard, {
  props: { order: makeOrder() },
  global: { plugins: [createTestingPinia(), router] },
})
await wrapper.get('button').trigger('click')
expect(wrapper.emitted('select')![0]).toEqual([order.id])
```

- 断言契约面：emitted 事件与载荷、渲染文本/结构、props 传参效果
  ——不断言内部 ref 状态（黑盒优先）。
- `mount` 全量默认；子组件隔离用 `shallowMount`/`stubs` 显式命名
  （`global.stubs: { HeavyChart: true }`）——无差别全 stub 是
  集成盲区。
- 异步收敛：`trigger`/`setValue` 后 `await nextTick()` 或
  `flushPromises()`（DOM 更新与微任务排空）；`Suspense`/异步组件
  用 `flushPromises` 配合。

## mock 边界

- `vi.mock('@/api', …)` 模块级 mock：网络层整体替换（响应工厂
  `makeOrder(overrides)` 控数据）。
- `createTestingPinia({ stubActions: true })`：store action stub、
  state 直改模拟（store 逻辑另有直测，组件测只验接线）。
- 路由：`createMemoryHistory` 内存实例；`route` 对象按需注入。
- **mock 收在边界**（API/store 动作/时间），断言行为结果——内部
  调用链 mock 是脆测试（重构即红）。

## 时间与异步

- `vi.useFakeTimers()` + `vi.advanceTimersByTime(1000)`：定时器/
  防抖受控——**绝不真睡**（`sleep`/真 setTimeout 等待是 flake 源）。
- `vi.useFakeTimers({ shouldAdvanceTime: true })` 兼容三方真时钟
  的混合场景。
- 在途请求取消路径（路由离开 abort）补断言。

## 快照与稳定性

- `toMatchSnapshot()` 窄用：结构回归（关键组件渲染形状）；快照
  diff 进 PR 评审；更新快照是显式 `-u` 动作。
- flake 三步：隔离复现（单跑/并发跑/换序）→ 根因（共享态/时序/
  外部依赖）→ 修复或 `test.skip` 带工单——不重跑掩盖。
- 测试环境 `happy-dom`（快）默认、`jsdom`（兼容广）按需——环境
  差异（getBoundingClientRect 等实现）引发的失败换环境标记清楚。

## 红线

- 真睡与轮询重试；断言私有状态/内部调用序列。
- 挂了就断言 `exists` 的覆盖率测试。
- mock 散进实现层（任何函数都可 mock 的测试不是契约测试）。
