# 声明、初始化与作用域（declarations-scope）

> 来源：Effective Go / Go Wiki CodeReviewComments（经 golang-skills 快照派生）；权威级：规范
> 最低 Go 版本：1.22 ｜ 核验日期：2026-10 ｜ 授权账本：`_sources.md`

## var vs := 决策树

```
在函数外？
├─ 是 → 只能 var（const / var / type / func）
└─ 否 → 零值即可用或需要显式类型？ → var x T（var buf bytes.Buffer）
        初始化表达式存在且类型显然？  → x := expr（n := len(s)）
        类型显然 = 右侧是字面量/构造器/同类型变量
```

- `:=` 左侧至少一个新变量；`a, err := f()` 中 err 已存在时是赋值不是
  声明——这正是遮蔽陷阱的入口（见下）。
- 包级变量可以 `var x = expr`，避免 init() 里赋值。

## 零值是有用的

```go
var b bytes.Buffer   // 直接 Write
var mu sync.Mutex    // 直接 Lock/Unlock
var s []int          // append 直接可用
m := make(map[K]V)   // map 写之前必须 make（nil map 写 panic）
```

不给"以防万一"的显式初始化（`s := []int{}` 起手是噪音）；函数返回
"无结果"用 nil，让调用方能区分。

## 分组声明与 iota

```go
type Kind int

const (
	KindUnknown Kind = iota
	KindUser
	KindSystem
	// 跳值用 _；位标志用 1 << iota
)
```

- iota 从 0 递增；表达式可复用（`1 << iota` 位掩码模式）。
- 跨版本稳定的序列化值显式写数字，不依赖 iota 顺序。

## 复合字面量

```go
// 好：字段名显式，可读且可扩展
srv := Server{Host: "localhost", Port: 8080}

// 嵌套直接字面量，不逐步赋值
cfg := Config{Log: LogConfig{Level: "info"}}
```

位置初始化只在"字段 ≤2 且顺序极稳"（如 `image.Point{10, 20}`）用。

## 作用域与遮蔽（shadowing）

作用域链：universe → package → file → function → block。内层声明
同名标识符即遮蔽外层：

```go
var err error
if _, err := f(); err != nil {   // := 声明了新 err，外层 err 仍是 nil
	log.Fatal(err)               // 只改了内层
}
return err                       // 永远 nil —— 经典 bug
```

判定法：`:=` 左侧全部已存在于**当前**作用域 → 赋值；有任一新变量 →
当前作用域新建全部（含"旧名"）。防坑三招：

1. 需要写外层 err 时先声明 `var err error`，内层用 `=`；
2. `go vet -shadow`（golangci-lint shadow 检查器）显影可疑遮蔽；
3. `if err := f(); err != nil` 只用于"处理完即返回"的短路形态。

## 类型别名 vs 类型定义

```go
type A = Existing   // 别名：同一类型，方法集互通
type B Existing     // 定义：新类型，需显式转换，不继承方法
```

别名用于迁移期兼容（`type Server = v2.Server`）；新类型用于语义区分
（`type UserID string`——防裸字符串混用）。

## new vs make

- `new(T)` 返回 `*T` 指向零值——结构体可用；slice/map/channel 零值
  不可用，要 `make`。
- `make(T, n)` / `make(T, n, cap)` 只初始化三种内建引用类型。
