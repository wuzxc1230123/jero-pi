# 异步纪律（async-patterns）

> 来源：Microsoft Learn 异步编程文档 / Task-based Asynchronous Pattern / dotnet-skills csharp-concurrency-patterns 快照；权威级：规范
> 锚定运行时：.NET 10 / C# 14 ｜ 核验日期：2026-10 ｜ 授权账本：`_sources.md`

## 心智模型

`async/await` 是"释放线程等结果"的语法：编译器把方法切成状态机，
await 点是挂起点。线程是稀缺资源（线程池默认上限 = 核数起步），
同步阻塞 IO 占住线程 = 吞吐天花板。

## 分层规则：ConfigureAwait

| 代码层 | `ConfigureAwait(false)` | 理由 |
|---|---|---|
| 类库（NuGet 分发） | 逐 await 加 | 消费方可能有同步上下文（UI/legacy ASP.NET） |
| ASP.NET Core 应用 | 不加 | 无同步上下文，加了无收益纯噪音 |
| 测试/host 通用库 | 加 | 同类库 |

团队把该表写进 convention，评审机械执行。

## 死锁两形态

1. **经典死锁**：同步上下文（UI 线程）里 `.Result` 阻塞等待，而
   await 完成回调需要同一上下文——永饿。解药是全链异步；库代码
   `ConfigureAwait(false)` 免疫。
2. **线程池饥饿**：请求路径大量 `.Result`/`.Wait()`，线程池注入
   速率（约每秒 1–2 条）跟不上排队——延迟雪崩、健康检查超时。
   `dotnet-counters` 的 threadpool-queue-length 持续增长是铁证
   （diagnostics-tools）。

## 取消传播链

```csharp
public async Task<Order?> FindAsync(int id, CancellationToken ct)
{
    ct.ThrowIfCancellationRequested();     // 入口快速退出
    var row = await _db.QueryAsync(sql, ct); // 逐层传，绝不丢弃
    return row is null ? null : Map(row);
}
```

- 公共异步 API 收 `CancellationToken`（惯例放尾参带默认值
  `CancellationToken cancellationToken = default`）。
- CPU 密集循环内分段 `ThrowIfCancellationRequested()`（每千次迭代
  量级检查一次，成本可忽略）。
- 取消是协作式的：不收/不传 = 链路断点；`ct.ThrowIfCancellationRequested`
  抛 `OperationCanceledException`，框架识别为取消而非失败。

## Task vs ValueTask

- 默认 `Task<T>`：可多次 await、可存储、可组合（`WhenAll`）。
- `ValueTask<T>` 只在"高频 + 同步完成占多数"（缓存命中、缓冲有
  数据）用：单次 await 语义，第二次 await 抛 `InvalidOperationException`；
  要复用先 `.AsTask()`。
- `IAsyncEnumerable<T>` 流式序列（`await foreach` + `WithCancellation`）
  是第四种返回形态（数据推送场景，见并发流水线）。

## 异常与观察

- `async` 方法异常进返回的 Task；不 await 不观察 = 吞异常（任务
  被静默回收，`TaskScheduler.UnobservedTaskException` 只是终局兜底）。
- fire-and-forget 必须包装：

```csharp
_ = RunSafeAsync();
async Task RunSafeAsync()
{
    try { await BackgroundSyncAsync(cts.Token); }
    catch (OperationCanceledException) { /* 预期退出 */ }
    catch (Exception ex) { _logger.LogError(ex, "background sync failed"); }
}
```

- `Task.WhenAll` 聚合（`await` 后只见第一个异常，`task.Exception`
  的 `InnerExceptions` 看全量）；`Task.WhenAny` 是竞速/超时实现件
  （`WaitAsync(TimeSpan)`/.NET 6+ 内建超时取消可直接用）。

## 反模式清单

- `async void`（事件处理器与重写签名除外——异常逃逸到进程）。
- `Task.Run` 包同步 IO 伪装异步（只是换线程阻塞）；`Task.Run` 用于
  CPU 卸载时也要约束并行度。
- `async` 无 `await`（CS1998 警告）：直接返回 `Task.FromResult`/
  去掉 async。
- 同步 API 旁边再写一个 `Async` 包装调 `.Result`（假异步）。
- `lock` 体内 await（编译器禁止）绕道 `Monitor` + 手动等待——用
  `SemaphoreSlim.WaitAsync` 或重构（concurrency-primitives）。
- 轮询 `Task.IsCompleted`（事件/`WhenAny`/回调才是正道）。

## 组合子速查

| 需求 | 构造 |
|---|---|
| 并发扇出 | `await Task.WhenAll(ts)` |
| 竞速/超时 | `await t.WaitAsync(TimeSpan.FromSeconds(3))` |
| 限流扇出 | `SemaphoreSlim` 窗口 或 `Parallel.ForEachAsync` |
| 流水线 | `Channel<T>` 生产消费（concurrency-primitives） |
| 重试/弹性 | `Polly`/标准 resilience 钩子（Aspire ServiceDefaults 接线） |
