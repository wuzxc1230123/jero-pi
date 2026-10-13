# sync 原语（sync-primitives）

> 来源：Go 标准库文档 / cc-skills-golang sync-primitives 篇（MIT）蒸馏；权威级：规范
> 最低 Go 版本：1.25 ｜ 核验日期：2026-10 ｜ 授权账本：`_sources.md`

## 选型表

| 需求 | 用什么 | 不用什么 |
|---|---|---|
| 单个数值计数/标志 | `atomic.Int64`/`atomic.Bool` | mutex 包一个 int |
| 复合不变量（多字段一致） | `sync.Mutex` | 多个 atomic 拼凑 |
| 读多写少的复合状态 | `sync.RWMutex`（真实读多才值得） | 无脑 RWMutex（锁升级开销） |
| 一次性初始化 | `sync.Once` | init 竞态标志位 |
| 等一组 goroutine | `sync.WaitGroup`（启动用 `wg.Go`，1.25+） | 手写 done channel 计数 |
| 键稳定、读多写少并发 map | `sync.Map` | 普通锁 map |
| 类型化零拷贝读写同步 | `sync/atomic` 的 Pointer[T] | interface{} + 断言 |

## mutex 纪律

```go
mu.Lock()
defer mu.Unlock()   // 锁紧贴临界区，defer 兜底 panic
// 临界区：维护不变量，不做 IO/系统调用/未知回调
```

- **锁内不做 IO/调用未知代码**：持锁时间放大 + 死锁面（回调里再拿锁）。
- **锁顺序全局约定**：多锁并取时固定顺序（如按字段声明序），写进
  包注释；违反 = 死锁。
- **tryLock**：`mu.TryLock` 只用于诊断/可放弃路径，不做自旋。
- 锁字段命名 `mu`，紧邻其保护的数据声明；保护范围写注释。

## atomic 细则

```go
var ready atomic.Bool
var count atomic.Int64
count.Add(1)
ready.Store(true)
if ready.Load() { ... }
```

- atomic 只保证单变量的可见性与原子性，**不保证复合不变量**——
  两个 atomic 之间的一致性要 mutex。
- `atomic.CompareAndSwap` 循环（CAS 旋）是 lock-free 的进阶形态，
  仅在 profile 证明 mutex 是瓶颈后使用。
- **内存序提示**：Go 的 happens-before 由 channel/sync/atomic 建立；
  "atomic Store 后另一个 goroutine Load 到了"≠ 其余变量也可见——
  需要复合可见性时老实用锁（Go 内存模型细节见官方 memory-model 文）。

## sync.Once / OnceFunc / OnceValue

```go
var connectOnce sync.Once
var conn *Conn
connectOnce.Do(func() { conn = dial() })

// 1.21+ 函数式形态（省字段声明）
loadConfig := sync.OnceValue(func() Config { return read() })
```

OnceFunc/OnceValue/OnceValues 是 1.21 的函数式糖，新代码优先。

## errgroup（golang.org/x/sync）

并发 + 错误聚合的标准答案（WithContext / SetLimit / Go / Wait），
形态见 concurrency-goroutines；它是"扇出同质任务"的默认入口。

## sync.Map 何时比锁 map 好

官方定位：键集合稳定（append-only 多）、读远多写、goroutine 间不
共享键集。其余场景（键 churn、需要 range 快照）锁 + 普通 map 更快
更好测。默认先锁 map，profile 再说。
