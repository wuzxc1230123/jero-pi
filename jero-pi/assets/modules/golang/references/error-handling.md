# 错误处理（error-handling）

> 来源：Go Blog "Errors are values"/"errors Are values" / Uber Go Style Guide（经两套快照派生）；权威级：规范
> 最低 Go 版本：1.26（AsType）｜ 核验日期：2026-10 ｜ 授权账本：`_sources.md`

## 策略决策树

```
错误产生了，如何处置？
├─ 系统边界（RPC/存储/IPC 响应）→ %v 包装，防内部细节泄漏
├─ 调用方需要匹配特定条件？
│   ├─ 静态条件 → 哨兵 var ErrXxx = errors.New(...) + %w
│   └─ 动态数据 → 自定义类型 XxxError + %w（配 errors.As）
├─ 只需要调试上下文 → fmt.Errorf("doing x: %w", err)
└─ 叶子函数（错误已足够自明）→ 直接 return err
```

默认动作：`fmt.Errorf("...: %w", err)`——加调用方没有的上下文，
`%w` 放句尾。不加上下文的包装不如直接返回。

## 匹配

```go
if errors.Is(err, os.ErrNotExist) { ... }          // 哨兵/等级
var perr *fs.PathError
if errors.As(err, &perr) { ... }                   // 类型提数
// Go 1.26+：泛型免目标变量
if perr, ok := errors.AsType[*fs.PathError](err); ok { ... }
```

- `err.Error()` 字符串比较/`strings.Contains` 永不（错误文案不是 API）。
- 哨兵错误的 doc comment 写明匹配方式：`// ErrClosed 匹配已关闭的连接`。

## 只处理一次（handle errors once）

```
错误到了这一层？
├─ 能处理（重试/降级/默认值）→ 处理，不返回错误
├─ 能加上下文 → 包装后 return
└─ 调用链顶（main/handler）→ 记日志 + 转响应/退出
   三选一。log-and-return 双做 = 下游再记一次 = 告警放大器。
```

## 包装矩阵

| 场景 | 动词 | 理由 |
|---|---|---|
| 同进程内部层间 | `%w` | 保留匹配链 |
| 跨系统边界响应 | `%v` 或自定义错误映射 | 防泄漏（SQL/路径/栈） |
| 日志/展示 | `%v` 或 `+v`（verbosely） | 人读 |
| 想让调用方匹配 | `%w` 恰一次 | 多 %w 用 fmt.Errorf 按 %w-ordered（1.20+） |

## 签名红线：exported 只返回 error

```go
// 坏：调用方 err != nil 判的是接口装箱，nil *MyError 装进接口后非 nil
func Parse(s string) (*MyError, bool)

// 好
func Parse(s string) error
```

typed-nil 陷阱：接口是（类型,值）二元组，具体类型 nil 装入后接口非
nil——返回具体错误类型是这类 bug 的批量生产机制。

## 错误文案

- 小写开头、无结尾标点、链式包装后可自然拼接（`open db: ping: timeout`）。
- 展示层（API 响应/UI）再映射为人话——不是错误值里预埋。

## 并发聚合

```go
g, ctx := errgroup.WithContext(ctx)
g.Go(func() error { return fetchA(ctx) })
g.Go(func() error { return fetchB(ctx) })
if err := g.Wait(); err != nil { return fmt.Errorf("fetch: %w", err) }
```

首个 error 触发 ctx 取消；全部收集用 `errors.Join` 或 multierr。

## panic 与错误的边界

- panic 只用于"程序员不变量被打破"（不可能状态）；可预期失败一律
  error 返回（详见 defensive-boundaries）。
- 库的兜底 recover 转 error 是边界义务，不是功能特性。
