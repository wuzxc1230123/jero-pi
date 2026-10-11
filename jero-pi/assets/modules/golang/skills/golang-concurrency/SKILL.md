---
name: golang-concurrency
description: 并发设计：goroutine 生命周期与泄漏防护、channel 所有权、sync 原语选型、errgroup 扇出、worker pool、wg.Go 收尾。当写并发代码、排查泄漏或选择同步机制时使用。触发词：并发、goroutine、channel、锁、mutex、泄漏、errgroup、worker pool、竞态。
---

# 并发（Go）

管"每个 goroutine 都要有出生证明和死亡证明"：并发正确性 = 生命周期明确 + 数据竞争归零，不是"加了 go 就快了"。

> **相关技能：** 取消与超时传播 → `golang-context`；表驱动与 -race 验证 → `golang-testing`；并发 bug 症状 → `golang-troubleshooting`。

## 何时使用

启动 goroutine、设计 channel、选择 mutex/atomic/waitgroup、排查泄漏或竞态时使用；评审并发变更必过本技能。

## 核心要点

- **生命周期先于吞吐**：每个 `go` 语句回答三个问题——谁让它退出（ctx/-done channel/完成信号）、谁等它退出（`wg.Go`（Go 1.25+）或 `wg.Add` 配对）、退出时资源谁清。答不上就是泄漏源。
- **`wg.Go(f)`**：Go 1.25 起的启动即计数形态（`wg.Go(func() {...})`），彻底消灭 Add/Done 配对失误；新代码默认用它。
- **channel 所有权**：发送方负责 close（接收方 close 是数据竞争级错误）；无接收者的发送要么带 ctx 退出要么缓冲有界；select 永远带 `case <-ctx.Done()` 分支（除非有明确理由）。
- **原语选型**：计数/标志位 → `atomic`；复合不变量 → `mutex`；一次性初始化 → `sync.Once`；同质并发扇出 → `errgroup.WithContext`（首个 error 即取消）；流水线 → 分层 channel；有界并发 → worker pool 或带缓冲 channel 当信号量。
- **临界区纪律**：锁内不做 IO/系统调用/调用未知代码（死锁与持锁放大）；锁的粒度护住不变量即可，不为性能提前拆。
- **无上限并发是红线**：扇出量必须有界（信号量/池/errgroup.SetLimit），"并发越多越快"在 IO 与调度上都会反噬。
- **数据竞争零容忍**：`go test -race ./...` 是验证门槛不是可选项；race 是未定义行为，"碰巧没炸"不算通过。

## 红线

- goroutine 无退出路径、接收方 close channel、缓冲无界的 fan-out。
- 锁内 IO；双锁顺序无全局约定（锁顺序死锁）。
- 用 time.Sleep 做"同步"（那是等待的伪装）。

## 深读指路（references/）

生命周期全文：`references/concurrency-goroutines.md`；channel 与 select 模式：`references/concurrency-channels.md`；sync 原语：`references/sync-primitives.md`。
