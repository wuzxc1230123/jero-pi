---
name: vue-testing
description: 测试实践：Vitest + Vue Test Utils、composable 纯逻辑与组件挂载分层、mock 收在边界（API/store 动作）、flushPromises 与 fake timers、快照纪律。当写或评审前端测试时使用。触发词：测试、Vitest、Vue Test Utils、mount、vi.mock、组件测试、快照。
---

# 测试实践（Vitest + Vue Test Utils）

前端测试分层是效率的根：composable 纯逻辑不挂 DOM（快而稳）、组件挂载测契约（props 进事件出）、路由与 store 在边界替换——分层倒了就是慢而脆。

> **相关技能：** 执行协议三道门 → `vue-tester`；composable 设计（可测性） → `vue-composables`；配置面 → `vue-tooling`。

## 何时使用

编写/评审单元与组件测试、治理测试稳定性、决定 mock 边界时使用。

## 核心要点

- **分层**：纯函数/composable 直测（`const { data } = useXxx()` 断言 ref）；组件契约测挂载（props 进/emitted 出/DOM 断言）；E2E 窄面冒烟（Playwright）——金字塔不倒置。
- **挂载纪律**：`mount` 全量（真实交互）、`shallowMount` 隔离子组件（只测本组件契约）；子组件 stub 显式命名；`global.plugins` 注入 router/pinia（`createTestingPinia` stub action）。
- **mock 收边界**：`vi.mock('./api')` 模块级 API mock、`createTestingPinia` stub store 动作——断言行为结果优先，内部调用链 mock 是脆测试（重构即红）。
- **异步收敛**：`flushPromises()` 后断言 DOM；`await nextTick()` 微任务边界；fake timers（`vi.useFakeTimers()` + `vi.advanceTimersByTime`）控时间绝不真睡。
- **数据工厂**：夹具工厂函数（`makeOrder(overrides)`）代替散装字面量；随机数据带 seed。
- **快照窄用**：`toMatchSnapshot()` 锁结构回归——快照 diff 进 PR 评审，更新快照是显式动作（`-u`），不当垃圾场无限膨胀。
- **环境**：`happy-dom`（快）默认，`jsdom`（兼容广）按需——测试环境与依赖锁版本进 `package.json`。

## 红线

- 测试内真睡（`setTimeout` 等待）与轮询重试掩盖 flake。
- 断言实现细节（私有状态/内部调用序列）而非公共契约。
- 为覆盖率补无行为断言的挂载测试（挂了就断言 exists）。

## 深读指路（references/）

测试谱系与反模式清单：`references/testing-practices.md`；验证协议（退出码三道门）：`references/verification-gates.md`。
