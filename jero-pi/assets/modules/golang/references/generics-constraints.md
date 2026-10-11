# 泛型与约束（generics-constraints）

> 来源：Go Blog "An Introduction To Generics" / Google Go Style Guide（经 golang-skills 快照派生）；权威级：规范
> 最低 Go 版本：1.26（自引用约束解禁）｜ 核验日期：2026-10 ｜ 授权账本：`_sources.md`

## 决策树：要不要泛型

```
场景是"多类型复用同一数据结构/算法"吗？
├─ 否（行为多态/可替换依赖）→ 接口（见 interface-design）
└─ 是 → 标准库 slices/maps/cmp 能解吗？
    ├─ 能 → 直接用（slices.Contains/Sort、maps.Keys）
    └─ 不能 → 已有 ≥2 个真实调用点吗？
        ├─ 否 → 先写具体类型，重复出现再泛化
        └─ 是 → 泛型，constraint 取满足需求的最小集
```

## constraint 设计

```go
// 最小化：只要可比等
func Index[T comparable](s []T, v T) int

// 联合：明确的类型集
func Sum[T ~int | ~int64 | ~float64](s []T) T

// 组合：接口组合 + 方法要求
type Stringer interface { String() string }
func Join[T interface { ~string | ~[]byte; Stringer }](parts []T) string

// golang.org/x/exp/constraints 的 Ordered（排序比较）
func Max[T constraints.Ordered](a, b T) T
```

- `~` 前缀纳入底层类型相同的命名类型（`type UserID string`）——
  需要接受用户命名类型时写 `~string` 而非 `string`。
- constraint 是 API 的一部分：发布即冻结，放宽是兼容、收紧是破坏。
- `any` 只在真正任意（序列化负载、容器透传）时用。

## Go 1.26：自引用类型约束解禁

```go
// 1.26 前编译错误；现在合法——约束引用自身类型参数（递归约束形态）
type Node[T any] interface {
	Child() T
	comparable
}
```

存量用 interface 嵌套 workaround 的代码可迁移；迁移批次走 go vet +
全量测试（升级剧本见 modern-go-versions）。

## 泛型 vs 接口对照

| 维度 | 泛型 | 接口 |
|---|---|---|
| 绑定时机 | 编译期特化 | 运行期派发 |
| 值语义 | 零装箱 | 装箱/间接调用 |
| 可 mock | 难（类型参数级） | 易 |
| 适用 | 容器/算法复用 | 行为多态/依赖替换 |
| 滥用形态 | 超级工厂/一参数万物 | 上帝接口 |

## 常用标准库泛型盘点

- `slices`：Clone/Concat/Contains/Index/Insert/Sort/SortFunc/
  BinarySearch/Equal——绝大多数 slice 算法不再手写。
- `maps`：Keys/Values/Clone/CopyFunc（1.23+ 迭代器形态
  `maps.Collect`/`maps.Insert`）。
- `cmp`：Ordered 约束定义处 + `cmp.Compare`/`cmp.Or`（1.22+，
  首个非零值选择器）。
- `sync/atomic` 的 `Pointer[T]`/`Value` 泛型形态（1.19+）。

## 反模式

- 单调用点泛型；`[T any]` 起手再类型 switch（那是接口该干的活）。
- 方法泛型不存在：Go 方法不允许自有类型参数（1.26 仍未放开）——
  需要"方法级泛型"时改为包级泛型函数 `func Do[T any](r Receiver, v T)`。
- 泛型 + 反射组合的"万能序列化"——两种动态机制叠加，类型安全双丢。
