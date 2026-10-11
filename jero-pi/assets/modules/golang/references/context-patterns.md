# context 模式（context-patterns）

> 来源：Go Blog "Go Concurrency Patterns: Context" / Google Go Style Guide（经 golang-skills 快照派生）；权威级：规范
> 最低 Go 版本：1.21（WithoutCancel）｜ 核验日期：2026-10 ｜ 授权账本：`_sources.md`

## 签名约定

- `ctx context.Context` 永远第一个参数、永远写全名（不缩写 c/ctx2）。
- 导出函数做 IO（网络/文件/DB/时间等待）必须收 ctx；纯内存计算的
  可以不收（可证无阻塞即可）。
- 结构体不存 ctx（见红线）；`http.Request.Context()` 是取的标准位。

## 派生矩阵

| 场景 | API | 备注 |
|---|---|---|
| 截止时间（知道最晚何时） | `context.WithDeadline` | 绝对时刻 |
| 预算时间（最多多久） | `context.WithTimeout` | 相对时长，最常用 |
| 手动取消一段 | `context.WithCancel` | `defer cancel()` 必跟 |
| 传值（仅横切元数据） | `context.WithValue` | 键用私有类型 |
| 后台续命但保值 | `context.WithoutCancel`（1.21+） | 审计日志/收尾写库 |
| 已到期/已取消立即返回 | `context.Canceled` 包一层 | 测试注入取消 |

铁律：**派生出来的 cancel 必须被调用**（`defer cancel()`），即使
ctx 已过期——泄漏 timer 与关联链。

## 传播模式

```go
func Handle(ctx context.Context, req *Req) error {
	ctx, cancel := context.WithTimeout(ctx, 2*time.Second)
	defer cancel()
	if err := db.Query(ctx, req.ID); err != nil {
		return fmt.Errorf("query: %w", err)
	}
	return nil
}
```

- 超时设在**发起 IO 的边界**（这里能看到预算全景），深处只检查。
- 绝不 `context.Background()` 替换传入 ctx——那是掐断调用方的取消权；
  真要脱离取消用 `WithoutCancel`（保留值与 trace 链）。

## 检查取消

```go
for i, item := range items {
	if err := ctx.Err(); err != nil {     // 逐批检查
		return err
	}
	process(item)
}
// 或阻塞点 select
select {
case <-ctx.Done():
	return ctx.Err()
case v := <-ch:
}
```

`ctx.Err()` 返回 `context.Canceled`（被取消）或
`context.DeadlineExceeded`（超时）——向上传播时保留原值，别换文案。

## 值的边界

```go
type traceIDKey struct{}          // 私有类型做键，防碰撞
ctx = context.WithValue(ctx, traceIDKey{}, id)
id, _ := ctx.Value(traceIDKey{}).(string)
```

- **只放请求域横切数据**：trace ID、tenant、认证主体、locale。
- 业务参数走函数参数——塞 ctx 的业务值 = 隐式全局变量 + 编译器无法
  检查的存在性。
- 取值断言两层（ok 与零值）；从未有值时静默零值是可接受的降级。

## 常见误用

| 误用 | 替代 |
|---|---|
| ctx 存 struct 字段 | 方法首参传 |
| ctx 传业务对象 | 函数参数 |
| 中途 Background() 重开 | WithTimeout(传入 ctx) 或 WithoutCancel |
| 忘 cancel | defer cancel() 紧跟派生 |
| nil ctx 传入 | 函数内 `if ctx == nil { ctx = context.Background() }` 仅限边界壳 |
