# 接口设计（interface-design）

> 来源：Rob Pike "Go Proverbs" / Go Wiki CodeReviewComments（经 golang-skills 快照派生）；权威级：规范
> 最低 Go 版本：1.22 ｜ 核验日期：2026-10 ｜ 授权账本：`_sources.md`

## 核心法则：接口定义在消费方

```go
// consumer.go（用的人定义自己要的最小面）
type Store interface {
	Get(ctx context.Context, key string) ([]byte, error)
}

func NewService(s Store) *Service { ... }

// store.go（实现方 unaware：不 import consumer 包，无 "implements" 声明）
type diskStore struct{ dir string }
func (d *diskStore) Get(ctx context.Context, key string) ([]byte, error) { ... }

// 编译期断言兜住"以为实现了"
var _ Store = (*diskStore)(nil)
```

- **accept interfaces, return structs**：参数收接口（调用方可注入
  任意实现），返回具体类型（调用方拿到全部能力）。
- 实现侧定义接口的合法例外：稳定契约的库（`sort.Interface`、
  `driver.Driver`）——契约由生态锚定，不由"我实现了"锚定。

## 大小与组合

```go
type Reader interface { Read(p []byte) (int, error) }
type Writer interface { Write(p []byte) (int, error) }
type ReadWriter interface { Reader; Writer }   // 组合出大行为
```

- 1–3 方法是常态；大接口 = 脆弱契约 + mock 痛苦。
- stdlib 的 io/io.Writer/io.Reader/io.Closer 是范式。
- "可选能力探测"模式：`if s, ok := w.(io.ReaderFrom); ok { ... }`
  ——接口断言做能力协商，而不是定义必选大接口。

## 何时造接口（时机三问）

1. 出现第二个实现了吗？——没有则不抽（写两遍再泛化）。
2. 测试需要替换真实依赖吗？——外部网络/时钟是正例；文件/DB 优先
   真实（`t.TempDir()`、`sqlite :memory:`），mock 是最后手段。
3. 包边界需要解耦吗？——跨包的方向性依赖（internal 不许 import 上层）
   用接口反转。

三问皆否还造接口 = 为唯一实现配接口 + mock 的双重税。

## 方法集与指针接收者

| 接收者 | 值 T 满足接口 | 指针 *T 满足接口 |
|---|---|---|
| 值接收者 `func (t T) M()` | ✓ | ✓ |
| 指针接收者 `func (t *T) M()` | ✗ | ✓ |

- 存进接口的是**值的拷贝**——大结构体或需变异状态时存指针。
- 值拷贝的隐藏成本：mutex 字段的结构体绝不能值拷贝（锁语义失效），
  `go vet` 的 copylocks 检查器会抓。

## typed-nil 的接口面

```go
var s *diskStore          // nil
var i Store = s           // 接口非 nil！（类型 diskStore，值 nil）
i == nil                  // false —— 经典陷阱
```

函数返回接口前确认具体值非 nil，或签名返回具体类型让调用方明确装箱
（详见 error-handling 的签名红线与 defensive-boundaries）。

## 接口与泛型的分工

数据结构/算法对多类型复用 → 泛型（编译期特化零装箱）；运行期行为
多态/可替换 → 接口。选型细讲见 generics-constraints。
