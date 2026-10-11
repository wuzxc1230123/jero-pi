# channel 与 select（concurrency-channels）

> 来源：Go Blog "Share memory by communicating" / cc-skills-golang channels-and-select 篇（MIT）蒸馏；权威级：规范
> 最低 Go 版本：1.22 ｜ 核验日期：2026-10 ｜ 授权账本：`_sources.md`

## 所有权规则

- **发送方 close，接收方永不 close**：向已关闭 channel 发送 = panic；
  双发送方时由唯一 owner（或专门的 closer goroutine）关闭。
- **close 是广播**：`v, ok := <-ch` 的 ok=false 与 `for range ch` 退出
  都在 close 后对**所有**接收者生效。
- **nil channel 的用途**：select 分支里 nil channel 永久阻塞——把
  不想启用的分支置 nil 是合法的禁用手法（状态机常用）。

## select 模式速查

```go
// 超时一收一发
select {
case v := <-ch:
	use(v)
case <-time.After(2 * time.Second):
	return errors.New("timeout")
}

// 可取消的发送
select {
case out <- v:
case <-ctx.Done():
	return ctx.Err()
}

// 非阻塞尝试
select {
case v := <-ch:
	use(v)
default:
	// 满了/空了，走别的路
}
```

## 流水线

```go
gen := func(ctx) <-chan int { out := make(chan int); go func(){ defer close(out); ... }(); return out }
sq := func(in <-chan int) <-chan int { out := make(chan int); go func(){ defer close(out); for v := range in { out <- v*v } }(); return out }
```

每级：自己的 out 自己 close；上级 in 由 for range 消耗；ctx 取消
贯穿全部 select。中途退出的消费者要么 drain（排空）要么让上游通过
ctx 停止——放着不管 = 上游永久阻塞在 send（泄漏）。

## fan-in / fan-out

- fan-out：一个源 channel 多消费者读（每条消息只到一人）——channel
  本身就是并发安全的任务队列。
- fan-in：多源合一用专门 merger（每源一个转发 goroutine + 等全部
  退出后 close 汇聚 channel，WaitGroup 守护）。

## 缓冲语义

- 无缓冲 = 同步握手（发送等接收）——默认选择，语义最明确。
- 有缓冲 = 解耦突发；容量是有意设计（信号量、批量聚合窗口），不是
  "调大点就不卡了"的玄学参数。
- `close` 后读剩余缓冲值合法；len/cap 只用于诊断，不做同步判断。

## 反模式

| 反模式 | 为什么 |
|---|---|
| 接收方 close | 与发送竞争，panic 面 |
| 用 channel 传错误再传数据的混合协议 | 拆成 (chan T, errgroup) 更清晰 |
| time.After 在循环里（<1.23） | 每轮新建 timer 不回收 |
| 无 default 的"非阻塞"意图 | 就变成阻塞了 |
| 深嵌套 select | 抽函数，goroutine 生命周期见 concurrency-goroutines |
