# 表驱动测试（testing-table-driven）

> 来源：Go Wiki "TableDrivenTests" / Google Go Style Guide（经 golang-skills 快照派生）；权威级：规范
> 最低 Go 版本：1.24（t.Context）｜ 核验日期：2026-10 ｜ 授权账本：`_sources.md`

## 骨架金样

```go
func TestParseDuration(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name    string
		input   string
		want    time.Duration
		wantErr error
	}{
		{"positive seconds", "5s", 5 * time.Second, nil},
		{"negative minutes", "-2m", -2 * time.Minute, nil},
		{"garbage rejects", "abc", 0, ErrInvalidUnit},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()                      // 1.22+ 直接引用 tc，无需复制
			got, err := ParseDuration(tc.input)
			if !errors.Is(err, tc.wantErr) {
				t.Fatalf("got err %v, want %v", err, tc.wantErr)
			}
			if got != tc.want {
				t.Errorf("got %v, want %v", got, tc.want)
			}
		})
	}
}
```

## 要点逐条

- **case 名是空格短语**（行为描述）：失败输出 `TestParseDuration/garbage_rejects`
  自证，不用翻测试体找 case_2 是什么。
- **1.22+ 无需 `tc := tc`**：循环变量每轮独立，`t.Parallel` 安全。
- **失败信息含 got/want**：`t.Fatalf`（致命，停止本 case）vs
  `t.Errorf`（记录继续）——预期失败后无法继续时用 Fatal。
- **错误列 `wantErr` 配 `errors.Is`**：nil 想要 nil、哨兵匹配哨兵；
  上例 `errors.Is(nil, nil)` 为 true，形态统一。
- **结构体对比用 cmp.Diff**：
  `if diff := cmp.Diff(want, got); diff != "" { t.Errorf("diff(-want +got):\n%s", diff) }`
  ——google/go-cmp；不可导出字段比较用 `cmp.AllowUnexported`。

## helper 纪律

```go
func mustParse(t *testing.T, s string) Duration {
	t.Helper()          // 失败行号指向调用处
	d, err := Parse(s)
	if err != nil {
		t.Fatalf("parse %q: %v", s, err)
	}
	return d
}
```

- 包装断言/构造的 helper 一律 `t.Helper()` 开头。
- 清理用 `t.Cleanup(fn)`（自动测试后执行、可注册多条）；临时目录
  `t.TempDir()`（自动清理）。
- 测试级 ctx 用 `t.Context()`（1.24+，测试结束自动取消）。

## 组织

- 同包白盒（`package foo`）测内部；`package foo_test` 黑盒测导出
  面——两者并存时导出面优先。
- 文件：`foo.go` ↔ `foo_test.go` 同目录；表驱动大表可拆 helper 文件
  `foo_cases_test.go`。
- 子测试层级 ≤2（`TestX/分支/场景`）；再深说明被测面太宽。

## 夹具与真实依赖

优先级：真实依赖（`t.TempDir()` 文件、`sqlite :memory:`、`httptest`
服务）> 注入 fake（fake clock/transport）> mock（接口桩）。mock 只
用于外部网络/不可注入的边界服务（时机判断见 interface-design 三问）。

## 禁止形态

- `t.Skip` 压失败（skip 要带条件与 issue 号）。
- 断言只写 `err != nil` 不看 want。
- 测试间共享包级可变状态（顺序依赖）——并行标志 `t.Parallel` 全开
  能把这类耦合炸出来。
