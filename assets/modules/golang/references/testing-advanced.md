# 测试进阶（testing-advanced）

> 来源：Go 官方 testing 文档 / cc-skills-golang testing 篇（MIT）蒸馏；权威级：建议
> 最低 Go 版本：1.26（ArtifactDir）｜ 核验日期：2026-10 ｜ 授权账本：`_sources.md`

## 并发与泄漏测试

```go
import "go.uber.org/goleak"

func TestMain(m *testing.M) {
	goleak.VerifyTestMain(m)      // 全套结束时验证无 goroutine 泄漏
}
```

- 并发原语的单测：done channel 断言 + `select { case <-done: case <-time.After(timeout): t.Fatal }`
  形态；绝不用裸 sleep 等待。
- 数据竞争：`go test -race ./...` 是 CI 门（race 是未定义行为）；
  竞态测试用 `go test -race -count=25` 提高撞出率。

## fuzz

```go
func FuzzParse(f *testing.F) {
	f.Add("5s")
	f.Add("-2m")
	f.Fuzz(func(t *testing.T, s string) {
		if _, err := Parse(s); err == nil {
			if _, err := time.ParseDuration(s); err != nil {
				return // 我们的扩展接受更多语法，合法
			}
		}
		// 断言：解析成功必须可往返
	})
}
```

- 种子 `f.Add` 覆盖已知边界；`go test -fuzz=FuzzXxx -fuzztime=30s`
  只在本地跑，CI 跑种子回归。
- 发现的 crasher 写回种子表（t.Fatalf 的最小样本）。

## 覆盖率

- `go test -cover ./...` 出百分比；`-coverprofile` + `go tool cover -html`
  看行级盲区。
- 覆盖率是**负空间工具**（找没测的分支），不是 KPI——为刷数写无断言
  测试是负资产。
- 分支覆盖看行级报告里红色段，不看总数。

## 测试工件（1.26+）

```go
func TestRender(t *testing.T) {
	dir := t.ArtifactDir()       // 命名工件目录：testartifacts/TestRender
	writeScreenshot(join(dir, "home.png"))
}
```

- `go test -artifacts=dir` 收集产物；golden 文件、截图、转储写进
  ArtifactDir 而非 os.TempDir 散落。
- CI 上传工件目录即证据链（替代"失败后到处找输出"）。

## 集成测试分离

- 构建标签 `//go:build integration` + `-tags=integration` 单独跑；
  或 `testing.Short()`：`if testing.Short() { t.Skip("integration") }`。
- 网络依赖显式化：外部端点走环境变量注入，缺变量 skip 带原因——
  不让无网环境的 CI 红一片。

## 基准挂点

- 基准与测试同文件可测性边界（`BenchmarkXxx`）；方法论全见
  benchmark-measurement（b.Loop/benchstat/CI 门禁）。

## 测试工具速查

| 需求 | 工具 |
|---|---|
| 结构体 diff | `github.com/google/go-cmp` |
| 泄漏检测 | `go.uber.org/goleak` |
| HTTP 桩 | `net/http/httptest` |
| 时间注入 | `now func() time.Time` 字段 |
| 断言库（可选） | testify 的 assert/require/suite——薄封装可接受，`require` 只在不可继续时用 |

引入 testify 前先问依赖四问（见 dependency-management）；标准库
testing + cmp 已覆盖核心。
