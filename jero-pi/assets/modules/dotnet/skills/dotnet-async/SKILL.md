---
name: dotnet-async
description: async/await 纪律：Task 与 ValueTask 取舍、ConfigureAwait 分层规则、CancellationToken 传播链、异常观察与取消协作。当写或评审异步代码时使用。触发词：async、await、Task、异步、死锁、CancellationToken、取消。
---

# 异步纪律（async/await）

异步是关于释放线程的，不是关于"后台"的：每个 `async` 方法都是状态机，每次错误选择都在积累线程池压力或死锁面。

> **相关技能：** 并发结构（Channel/并行） → `dotnet-concurrency`；卡顿与线程池诊断 → `dotnet-diagnostics`。

## 何时使用

写或评审任何 `async` 方法、设计取消传播、排查死锁/线程池饥饿的代码面成因时使用。

## 核心要点

- **一路异步到底**：调用链从入口到 IO 全异步；任何一层 `.Result`/`.Wait()` 都是死锁候选（同步上下文/线程池耗尽两形态）。
- **库代码 `ConfigureAwait(false)`**：类库（无同步上下文假设）逐 await 加；应用层（ASP.NET Core 无同步上下文）不加是惯例——分层规则写进团队约定。
- **取消传播**：公共异步 API 首参或次参收 `CancellationToken`；逐层传递不半路丢弃；CPU 密集循环内 `token.ThrowIfCancellationRequested()` 分段检查。
- **ValueTask 的窄面**：高频同步完成路径（缓存命中/缓冲有货）才用 `ValueTask<T>`——只能 await 一次、不能多次存储；默认仍是 `Task<T>`。
- **异常观察**：fire-and-forget 必须兜底（`_ = SafeAsync().ContinueWith(t => Log(t.Exception), OnlyOnFaulted)` 或包装助手）；`Task.WhenAll` 聚合后逐异常处理。
- **`Task.Run` 只做 CPU 卸载**：包同步 IO 伪装异步是反模式；`Task.Yield()` 重排队是气味。

## 红线

- `async void`（事件处理器/重写虚方法签名外）；`await` 缺失的"异步"调用返回值被丢弃无 `_ =` 与日志。
- `CancellationToken` 参数收了不传（链路断在手里）。
- 锁内 `await`（`lock` 体内不可等待——用 `SemaphoreSlim.WaitAsync`）。

## 深读指路（references/）

异步全谱（状态机成本/同步上下文史/取消协作/异常模型）：`references/async-patterns.md`。
