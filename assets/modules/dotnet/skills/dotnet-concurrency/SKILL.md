---
name: dotnet-concurrency
description: 并发原语选型：System.Threading.Channels 生产者/消费者、System.Threading.Lock（.NET 9+）、Interlocked、Parallel.ForEachAsync、无锁与有锁的边界。当设计并发结构或评审共享状态时使用。触发词：并发、Channel、锁、线程安全、数据竞争、并行。
---

# 并发原语选型

并发问题先分形状再选工具：IO 并发交给 async，生产者/消费者交给 Channel，共享计数交给 Interlocked，真正争抢的短临界区才上锁。

> **相关技能：** 异步纪律 → `dotnet-async`；有状态实体高并发 → `dotnet-akka`；数据竞争取证 → `dotnet-diagnostics`。

## 何时使用

设计并发结构（流水线/工作池/扇出扇入）、评审共享状态访问、选锁或无锁方案时使用。

## 核心要点

- **Channel 是结构答案**：有界 `Channel.CreateBounded<T>` 提供背压（`Wait` 写者阻塞到有容量）；单读者 `SingleReader` 选项解锁优化路径；生产者/消费者与流水线不用手写队列+锁。
- **锁的分层（.NET 9+）**：`System.Threading.Lock` 是新默认（JIT 内联进薄锁路径）；`Mutex` 跨进程、`ReaderWriterLockSlim` 读多写少、`SemaphoreSlim` 可异步等待。
- **锁纪律**：临界区只做内存操作（锁内 IO/await 是红线）；`lock (private readonly object _gate = new())` 私有锁对象——永不锁 `this`/`typeof`/`string`。
- **Interlocked 窄面**：计数/标志/最小最大（`Interlocked.CompareExchange` 的 CAS 循环）；无锁队列/栈只在 profiling 证明锁争抢后才考虑（`ConcurrentDictionary` 的 `GetOrAdd` 注意工厂可能多次执行）。
- **CPU 并行**：`Parallel.ForEachAsync`（带异步体的并行、`MaxDegreeOfParallelism` 约束）；PLINQ 数据并行看负载形状；并行度默认留 CPU 核数，IO 并行显式放大。
- **不可变是并发的基础**：共享只读数据零同步；变更走"新值交换"（`volatile` 字段/`Interlocked.Exchange`）而非原地改。

## 红线

- `volatile` 当同步原语用（只保可见性与顺序，不保原子复合操作）。
- 无界队列吸收生产过剩（缺背压的 Channel/`BlockingCollection`）。
- 双重检查锁定无 `volatile`/`Lazy<T>` 的手写实现。

## 深读指路（references/）

原语谱系与选型决策树（内存模型/CAS/背压设计）：`references/concurrency-primitives.md`。
