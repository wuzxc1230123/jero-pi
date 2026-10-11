# goroutine 生命周期（concurrency-goroutines）

> 来源：Go Blog / Effective Go / cc-skills-golang concurrency 篇（MIT）蒸馏；权威级：规范
> 最低 Go 版本：1.25（wg.Go）｜ 核验日期：2026-10 ｜ 授权账本：`_sources.md`

## 出生证明三问（每个 go 语句必答）

1. **谁让它退出**——ctx.Done() / 关闭 done channel / 完成？
2. **谁等它退出**——`wg.Go(f)` / errgroup / `<-doneC`？
3. **退出时谁清资源**——defer 链在哪一层？

任一答不上 = 泄漏源。泄漏形态：goroutine 卡在 send/recv 等一个永不
来的信号，持有的内存永不释放（heap inuse 只涨不降的常见根因）。

## wg.Go：启动即计数（Go 1.25+）

```go
var wg sync.WaitGroup
for _, task := range tasks {
	wg.Go(func() { process(task) })   // Add/Done 由 wg.Go 原子配对
}
wg.Wait()
```

- 彻底消灭 `wg.Add` 与 `Done` 配对失误（Add 在 goroutine 内 = Wait
  可能先返回的经典竞态）。
- 存量 `wg.Add(1); go func(){ defer wg.Done(); ... }()` 在 go fix 的
  waitgroup 现代化器射程内，升级批次顺手迁移。

## 退出模式选型

| 任务形态 | 模式 |
|---|---|
| 扇出同质任务、首个错即停 | `errgroup.WithContext` + `g.Go` |
| 扇出但限制并发度 | `errgroup` + `g.SetLimit(n)` |
| 长驻 worker 池 | 固定 N worker 消费 jobs channel，关闭 jobs 收尾 |
| 周期任务 | ticker + ctx.Done() select 退出 |
| 单发后台 | `wg.Go` + 传入 ctx |

## 取消传播金样

```go
func worker(ctx context.Context, tasks <-chan Task) error {
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case t, ok := <-tasks:
			if !ok {
				return nil
			}
			if err := handle(ctx, t); err != nil {
				return fmt.Errorf("handle: %w", err)
			}
		}
	}
}
```

要点：select 双臂齐备；`!ok` 分支处理发送方关闭；处理函数继续收 ctx。

## 泄漏检测

- 测试期：`goleak.VerifyNone(t)`（uber-go/goleak）在 TestMain 验证。
- 运行期：goroutine profile（`/debug/pprof/goroutine`）看数量趋势；
  Go 1.26 实验性泄漏剖析（`GOEXPERIMENT=goroutineleakprofile`）可
  指认"谁创建的 goroutine 没退"。
- 症状面排查见 troubleshooting-bugs。

## 有界并发

```go
g, ctx := errgroup.WithContext(ctx)
g.SetLimit(8)
for _, u := range urls {
	g.Go(func() error { return fetch(ctx, u) })
}
err := g.Wait()
```

无上限扇出 = 对下游的 DoS + 对自身调度器的压力测试，红线见
golang-concurrency 技能。
