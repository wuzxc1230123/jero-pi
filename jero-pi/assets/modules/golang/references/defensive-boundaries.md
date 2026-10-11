# 防御性边界（defensive-boundaries）

> 来源：Uber Go Style Guide / Go Wiki（经 golang-skills 快照派生）+ cc-skills-golang safety 篇（MIT）蒸馏；权威级：规范
> 最低 Go 版本：1.22 ｜ 核验日期：2026-10 ｜ 授权账本：`_sources.md`

## 边界拷贝矩阵

| 传递物 | 风险 | 防御 |
|---|---|---|
| 入参 slice | 调用方持有底层数组，函数返回后可能并发改 | 只读遍历安全；要持有/后台用 `slices.Clone(s)` |
| 入参 map | 同上，且无 cap 语义 | 同上；文档声明"不持有" |
| 返回内部 slice/map | 外部可改内部状态 | 返回拷贝，或返回值语义（迭代器 `func(yield func(T) bool)`，1.23+） |
| 结构体字段含引用类型 | 浅拷贝共享底层 | 文档声明；深拷贝显式提供 `Clone()` |

API 文档写明所有权约定："返回的切片在下次调用前有效"类条款必须显式。

## typed-nil 与 nil 语义

- `err != nil` 之前确认签名是 `error` 接口（详见 error-handling）。
- 检查接口入参时用反射级小心：`reflect.ValueOf(x).IsNil()` 只对
  nilable 类型合法。
- 返回 `(T, error)` 时 T 的错误态值要文档化（"err 非 nil 时 T 为零值"）。

## Must 函数纪律

```go
var pattern = regexp.MustCompile(`^v\d+`)   // 对：包初始化、静态数据
func Compile(s string) { return MustParse(s) }  // 错：运行期数据走 error
```

- Must* 只用于"失败即程序员错误"的启动期/字面量场景。
- 运行期输入（用户配置、网络数据）永不 Must——那是 panic 转 500。

## panic/recover 边界

```go
func (h *Handler) ServeHTTP(w, r) {
	defer func() {
		if p := recover(); p != nil {
			slog.Error("panic recovered", "panic", p, "stack", debug.Stack())
			http.Error(w, "internal error", 500)
		}
	}()
	// ...
}
```

- 库代码不 panic 出包边界（可预期失败 error 返回）。
- 顶层 recover 的合法位置：HTTP/worker/插件的入口壳；recover 必须
  记录（栈 + 值），静默吞掉比崩溃更糟。
- recover 后不得继续使用已损坏状态——转错误、拒绝后续请求。

## 可变全局禁令

- 包级 `var` 可变状态 = 隐式全局耦合（并发 + 测试隔离双杀）。
- 替代：依赖注入（构造器参数/结构体字段）；真正全局只读常量与
  `sync.Once` 初始化的不可变值（如 `regexp.MustCompile`）豁免。

## 时间纪律

- 时刻 `time.Time` + `time.Equal`（时区无关比较）；时长
  `time.Duration`；绝不裸 int64 毫秒跨 API。
- `time.Now()` 注入：`now func() time.Time` 字段——测试可冻结时间。
- 定时器：`time.After` 在循环内泄漏（1.23 前不回收）；循环等待用
  `NewTimer` + Reset 或 ticker。

## 枚举与封闭集合

- 字符串状态字段用显式类型 + 常量集合（`type Status string`），
  入口处 switch 校验未知值——防上游加值静默穿透。
- json tag 的字段类型与 API 版本演进同步考虑（新增枚举值 = 兼容面
  决策，不是随手加）。

## crypto/rand 红线

安全敏感随机（token/盐/密钥/会话 ID）一律 `crypto/rand`；
`math/rand` 的输出可预测（v2 默认种子仍是可预测的）——详见
security-injection-crypto。
