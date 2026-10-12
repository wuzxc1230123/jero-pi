# 并发原语（concurrency-primitives）

> 来源：dotnet-skills csharp-concurrency-patterns 快照（async→Channel→Akka 选型层级）/ Microsoft Learn 线程化文档；权威级：规范+建议
> 锚定运行时：.NET 10 / C# 14 ｜ 核验日期：2026-10 ｜ 授权账本：`_sources.md`

## 选型决策树

```
并发问题什么形状？
├─ IO 并发（等外部） → async/await + Task.WhenAll（async-patterns）
├─ 生产者/消费者（速率解耦）→ System.Threading.Channels
├─ 共享计数/标志 → Interlocked 原子族
├─ 短临界区内存操作 → System.Threading.Lock（.NET 9+）
├─ 读多写少 → ReaderWriterLockSlim / 不可变快照交换
├─ CPU 数据并行 → Parallel.ForEachAsync / PLINQ
├─ 跨进程互斥 → Mutex
└─ 有状态实体高并发一致性 → actor（Akka.NET，akka-patterns）
```

优先级：不可变 > 结构化（Channel/WhenAll）> 原子 > 锁。每往下一
格，心智成本与错误面都在涨。

## System.Threading.Channels

```csharp
var channel = Channel.CreateBounded<Order>(new BoundedChannelOptions(1000)
{
    SingleReader = false, SingleWriter = false,
    FullMode = BoundedChannelFullMode.Wait,   // 背压：写者等待
});
await foreach (var order in channel.Reader.ReadAllAsync(ct))
    await ProcessAsync(order, ct);
await channel.Writer.WriteAsync(order, ct);
```

- **有界是默认**：无界队列把过载转嫁成内存炸弹；`FullMode.Wait`
  产背压、`DropOldest/DropWrite` 配合 `TryWrite` 做削峰。
- `SingleReader/SingleWriter` 声明后运行时走优化路径（虚假声明
  引发未定义行为）。
- 完成语义：生产完毕 `writer.Complete()`（可带异常）；消费者
  `ReadAllAsync` 自然收尾。
- 典型拓扑：IO 读 → Channel → 工作者组（N 个 `ReadAllAsync` 消费
  者）→ 聚合——代替手写 `Queue + lock + Monitor.Pulse`。

## 锁族谱

| 原语 | 场景 | 注意 |
|---|---|---|
| `System.Threading.Lock` | .NET 9+ 通用短临界区 | JIT 走薄锁内联；`lock (myLock)` 新代码默认 |
| `Monitor`（旧 `object` 锁） | 存量代码 | 同语义，勿混用两种锁对象 |
| `SemaphoreSlim` | 异步等待的信号量/限流 | `WaitAsync`；不跨进程 |
| `Mutex` | 跨进程 | 放弃需释放（`AbandonedMutexException`） |
| `ReaderWriterLockSlim` | 读多写少 | 递归策略显式；升级锁是坑 |
| `SpinLock` | 极短自旋（微秒级） | 很少需要；测量后再上 |

锁纪律：私有 `readonly` 锁对象专锁专物；临界区只做内存操作（锁内
IO/await 是红线）；持锁时间纳秒级目标；嵌套锁按全局序防死锁。

## Interlocked 与内存模型

- `Increment/Decrement/Add/Exchange/CompareExchange` 原子族：计数、
  标志、单变量发布。
- CAS 循环（`CompareExchange` 重试）实现无锁算法——正确性依赖
  .NET 内存模型保证（引用写原子 + ECMA 屏障语义）；自写无锁结构
  前先找现成的（`ConcurrentDictionary`/`ConcurrentQueue`）。
- `volatile`：只保可见性与编译器/硬件重排约束，**不保复合操作原
  子性**——`volatile int x; x++` 仍丢更新。它是"发布标志"工具，
  不是同步原语。

## 并行（CPU）

```csharp
await Parallel.ForEachAsync(items,
    new ParallelOptions { MaxDegreeOfParallelism = Environment.ProcessorCount, CancellationToken = ct },
    async (item, ct) => await ProcessAsync(item, ct));
```

- `Parallel.ForEachAsync`（.NET 6+）异步体并行的事实标准；并行度
  显式约束（默认 = 核数，IO 型任务另说）。
- PLINQ（`AsParallel()`）数据并行管道；顺序敏感时 `AsOrdered`
  （有代价）。
- `ConcurrentDictionary` 的 `GetOrAdd` 工厂可能并发多次执行——工厂
  幂等或接受重复构建成本。
- 并行错误聚合为 `AggregateException`，逐内层处理。

## 不可变与快照

- 共享只读数据零同步（`readonly` record / frozen 集合
  `FrozenDictionary`（.NET 8+，读侧最优））。
- 变更走"构建新值 + 单引用交换"（`Interlocked.Exchange`/`Volatile.Write`
  发布）——读侧无锁看快照。
- 真正争抢的复合状态（聚合根/会话）升级 actor（akka-patterns），
  别在锁里堆业务。

## 测试与取证

- 并发缺陷用压测暴露（`Task.WhenAll` 打满 + 取消传播断言，
  testing-practices）；竞态不靠 sleep 重试掩盖。
- 争抢/饥饿取证走 `dotnet-counters`（contention 计数器）与
  `dotnet-trace`（diagnostics-tools）。
