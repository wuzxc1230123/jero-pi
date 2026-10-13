# 风格与格式（style-and-formatting）

> 来源：Google Go Style Guide / Effective Go（经 golang-skills 快照派生）；权威级：规范
> 最低 Go 版本：1.22 ｜ 核验日期：2026-10 ｜ 授权账本：`_sources.md`

## 优先级序（冲突时前者胜）

清晰 > 简单 > 简洁 > 可维护 > 一致。每一条都可牺牲下一条换取上一条，
反向不行——为简洁牺牲清晰是 Go 评审里最常见的打回理由。

## 格式：gofmt 是唯一权威

- `gofmt -l .` 输出必须为空；争论结束于此。`goimports` 在 gofmt 之上只
  多管 import 排序。
- 唯一允许的手工干预场景：结构性换行让 diff 更可读（如函数参数按语义
  分组换行）——但产物仍必须过 gofmt。

## 结构惯例

### guard clause 早返回

```go
func Process(r *Request) error {
	if r == nil {
		return errors.New("nil request")
	}
	if err := r.Validate(); err != nil {
		return fmt.Errorf("validate: %w", err)
	}
	// 主路径零缩进
	return nil
}
```

嵌套超过 2–3 层是抽函数的信号；"成功路径右移一格"的箭头反模式（
`if ok { if ok2 { ... } }`）一律重写为 guard。

### 行宽与拆行

软限 ~99 字符：超出先想能否抽中间变量或抽函数，然后才是拆行。函数
调用拆行每参数一行、`f(` 与 `)` 对齐；字符串字面量不硬拆。

### 分组

- import：标准库 / 第三方 / 本项目，空行分隔。
- const/var：按语义分组（不是按字母序）；关联常量放同一 `const` 块。
- 函数序：构造器（New*）在类型定义后；导出在前未导出在后；文件内按
  使用顺序而非字母序。

## 注释纪律

- 注释给"为什么"：约束、权衡、坑；不复述"做什么"（代码自己会说）。
- 文档注释（doc comment）以名字开头：`// Name does ...`（导出符号必写）。
- 注释掉的代码删除（git 记得）；`// TODO(user):` 带责任人与 issue。
- 包注释 `// Package foo ...` 放任一文件，一个包只一处。

## 坏味道速查

| 味道 | 重写方向 |
|---|---|
| 嵌套 ≥3 层 | guard clause / 抽函数 |
| 函数 >60 行且多段 | 按阶段抽函数 |
| 参数 >4 个 | 选项结构体或函数选项（3+ 可选参数时） |
| 同名缩写风格混用（URL/Url） | 全大写缩写（见 naming） |
| "聪明"的单行复合逻辑 | 显式分步 + 中间变量 |

## 与工具的分工

gofmt 管空白/换行；`go vet` 与 golangci-lint 管机械反模式（unused/
shadow 等）；本篇管结构与人读的判断——工具能定的不写进评审意见。
