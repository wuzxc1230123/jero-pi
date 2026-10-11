# slog 日志（logging-slog）

> 来源：Go 官方 log/slog 文档 / golang-skills logging 面 / cc-skills-golang slog 篇（MIT）蒸馏；权威级：规范
> 最低 Go 版本：1.26（NewMultiHandler）｜ 核验日期：2026-10 ｜ 授权账本：`_sources.md`

## 起步形态

```go
logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{
	Level: slog.LevelInfo,
}))
slog.SetDefault(logger)

slog.Info("order processed",
	"order_id", id,
	"duration_ms", elapsed.Milliseconds(),
	"status", "ok")
```

- 新代码一律 slog（1.21+）；裸 `log` 只在还没接 slog 的过渡期。
- 结构化 JSON 是服务默认；开发本地 TextHandler（可读）由配置切。

## 级别矩阵

| 级别 | 判定标准 | 典型 |
|---|---|---|
| DEBUG | 排障细节，默认关 | 请求体转储、状态机转移 |
| INFO | 正常生命周期事件 | 启动/就绪/请求完成摘要 |
| WARN | 可自动恢复的异常 | 重试成功、降级生效、接近限额 |
| ERROR | 需要人看/可能触发告警 | 下游持续失败、数据不一致 |

- "这行代码不太确定"不是 ERROR——ERROR 的社会契约是告警。
- 动态级别：`HandlerOptions.Level` 可换 `*slog.LevelVar`（运行时调）。

## logger 传递

```go
// 默认：显式注入（依赖可见）
type Service struct { log *slog.Logger }
func New(log *slog.Logger) *Service { return &Service{log: log} }

// 横切中间件可用 ctx 携带（装配处注入）
func WithLogger(ctx context.Context, log *slog.Logger) context.Context
func FromContext(ctx context.Context) *slog.Logger
```

- 库代码**不碰全局 logger**：库返回错误，应用层决定记什么；库要记
  也收 `*slog.Logger` 参数（可 nil 容忍 + `slog.Default()` 兜底）。
- 子 logger 预置字段：`log.With("tenant", t)` 装配期造，热路径免重复
  传参。

## 多目的地与采样（1.26+）

```go
// 1.26 原生多 handler：同一事件写多处（如 stdout + 阈值告警通道）
h := slog.NewMultiHandler(
	slog.NewJSONHandler(os.Stdout, nil),
	&alertingHandler{Threshold: slog.LevelError},
)
log := slog.New(h)
```

- 采样与过滤用中间 handler 包装（采样/脱敏都是 handler 装饰器）；
  高吞吐日志 DEBUG 级别用 LevelVar 运行时打开窗口而非常开。

## 脱敏

```go
var sensitive = []string{"authorization", "cookie", "token", "password", "secret"}

func sanitize(groups []string, a slog.Attr) slog.Attr {
	key := strings.ToLower(a.Key)
	if slices.Contains(sensitive, key) {
		return slog.String(a.Key, "[REDACTED]")
	}
	return a
}
// NewJSONHandler(w, &slog.HandlerOptions{ReplaceAttr: sanitize})
```

- 入口 handler 统一脱敏（不靠每处调用点自觉）；用户自由输入进消息
  字符串前清洗换行（日志注入）。
- PII 面（邮箱/电话/IP）按项目合规要求进清单。

## 错误与日志的边界（联 error-handling）

```go
if err := do(ctx); err != nil {
	return fmt.Errorf("do: %w", err)   // 返回，不记
}
```

记日志即处理：返回链顶（main/handler）一处记录。`slog.Error(...,
"err", err)` 后再 return err = 双记。日志字段名项目内统一（snake_case
或 kebab-case 二选一全仓一致）。

## 迁移

- `log.Print` → `slog.Info`（`slog` 默认 handler 兼容旧 log 输出）；
  logrus/zap 存量按模块边界分批换，handler 层保输出格式兼容采集端。
