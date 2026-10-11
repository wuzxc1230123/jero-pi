# CLI 工程（cli-engineering）

> 来源：cc-skills-golang cli 篇（MIT，可编译示例工程蒸馏）；权威级：建议
> 最低 Go 版本：1.26（NotifyContext 带 cause）｜ 核验日期：2026-10 ｜ 授权账本：`_sources.md`

## run 模式（入口骨架）

```go
func main() {
	if err := run(context.Background()); err != nil {
		fmt.Fprintln(os.Stderr, "myapp:", err)
		os.Exit(1)
	}
}

func run(ctx context.Context) error {
	// 装配 flag → 配置 → 依赖 → 执行；defer 清理在这里有效
}
```

- main 只做一件事：run 的错误 → stderr + 退出码。`defer` 在 main
  里 os.Exit 前不执行的陷阱由此规避。
- 用法错误（flag 解析失败）退出码 2；运行失败 1；`--help`/`--version`
  成功退出 0。

## 退出码表

| 码 | 语义 |
|---|---|
| 0 | 成功（含 help/version） |
| 1 | 运行失败（IO/依赖/逻辑） |
| 2 | 用法错误（flag 不认识/参数缺） |

脚本调用方（CI/编排器）依赖退出码契约——"永远 0" = 下游检测不到
失败，红线。

## 流分离

- **stdout = 数据**（管道消费：`myapp list -json | jq`）；**stderr =
  诊断**（进度、错误、警告）。
- 提示语/颜色/进度条绝不进 stdout（破坏管道）；TTY 检测
  （`term.IsTerminal(os.Stdout.Fd())`）非 TTY 自动关颜色与动画。

## 信号与优雅关闭

```go
ctx, stop := signal.NotifyContext(context.Background(),
	os.Interrupt, syscall.SIGTERM)
defer stop()

// Go 1.26+：取消携带 cause（signal.ContextCause 返回触发信号）
srv := newServer()
if err := srv.Run(ctx); err != nil && !errors.Is(err, context.Canceled) {
	return fmt.Errorf("run: %w", err)
}
```

关闭次序：停止接收新工作 → 停止接收（关 listener/拉黑健康检查）→
在途处理完（带 `context.WithTimeout` 的硬上限）→ 关资源（DB/队列）
→ 退出。SIGTERM 语义是"请退出"，绝不丢在途请求立刻死（编排器的
grace period 内完成；超时上报给编排器）。

## flag 分层

```
命令行 flag  >  环境变量  >  配置文件  >  内置默认值
```

- 标准库 `flag`：`flag.NewFlagSet(cmd, flag.ExitOnError)` 子命令
  dispatch；显式 > 隐式的覆盖方向固定。
- 子命令树复杂（嵌套/补全/帮助生成）再上 cobra 类——引入前过依赖
  四问（dependency-management）。
- 环境变量名带应用前缀（`MYAPP_LOG_LEVEL`）；配置文件路径可注入。

## 输出契约

- 默认输出人读（简洁表格/列表）；`-json` 输出稳定 schema：
  字段只加不改、时间用 RFC3339、未知字段容忍（前向兼容）。
- JSON 行流式输出（`json.Encoder` 逐行 Encode）支持管道增量消费。
- `--version` 输出：`myapp 1.2.3 (go1.26.0, commit abc123)`——
  构建期 ldflags 注入。

## 可测性

```go
// CLI 逻辑收进可测函数：args 与 IO 全注入
func Run(args []string, stdout, stderr io.Writer) error {
	fs := flag.NewFlagSet("myapp", flag.ContinueOnError)
	fs.SetOutput(stderr)
	// ...
}
```

- `httptest` 起本地服务测子命令；`t.Setenv` 隔离环境变量。
- 退出码契约测试：表驱动（args → wantExitCode）。
