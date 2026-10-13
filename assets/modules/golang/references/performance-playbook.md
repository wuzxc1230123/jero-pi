# 性能优化手册（performance-playbook）

> 来源：cc-skills-golang performance 篇（MIT，6 篇蒸馏）；权威级：建议
> 最低 Go 版本：1.26（Green Tea GC 默认）｜ 核验日期：2026-10 ｜ 授权账本：`_sources.md`

## 流程铁律

```
定目标（延迟分布/分配预算）→ pprof/trace 找热点 → 改一处
→ benchstat 验证 → 负载验证 → 提交（带证据）
```

跳过"找热点"的优化是盲改；跳过"负载验证"的合入是微基准胜利。

## 分配削减（第一优先级）

| 模式 | 换成 | 备注 |
|---|---|---|
| `fmt.Sprintf("%d", n)` 热路径 | `strconv.Itoa`/`strconv.AppendInt` | 5–10× 差距常见 |
| 循环 `s += x` | `strings.Builder` + `Grow(n)` | O(n²) → O(n) |
| `make([]T,0)` 后 N 次 append | `make([]T, 0, n)` 预知容量 | map 同理 |
| 反复 `[]byte(s)`/`string(b)` | 边界处一次转换传下去 | 转换 = 分配+拷贝 |
| 接口装箱 `any` 高频传值 | 泛型/具体类型 | 见 generics-constraints |
| 高分配率小对象 | `sync.Pool` | Get 后清引用再 Put |

## sync.Pool 细则

```go
var bufPool = sync.Pool{New: func() any { return new(bytes.Buffer) }}

func process() string {
	b := bufPool.Get().(*bytes.Buffer)
	defer func() { b.Reset(); bufPool.Put(b) }()   // 清引用后归还
	// ...
}
```

- 池对象 Put 前清空引用（防池钉住大对象图）；仅高分配率场景有收益
  （GC 压力实测为准，不是默认姿势）。

## CPU 热路径

- 反射/类型断言循环 → 一次性提出循环外或换泛型。
- 热点函数的接口调用 → 具体类型直调（profile 证明派发开销显著时）。
- 算法复杂度永远优先于常数（宽条在 O(n²) 循环里调 strconv 没意义）。
- 内联敏感的小函数保持小（编译器预算内）；`//go:noinline` 只用于
  防测量假象。

## 内存布局

- 字段按尺寸降序（指针后置/对齐填充削减）：`struct{ a,b byte; i int64 }`
  优于 `struct{ i int64; a,b byte }`+padding 的反向形态。
- 大结构体传参/入接口取指针（拷贝成本与逃逸权衡，profile 定）。
- 切片复用窗口：处理管道的中间缓冲反复 Clone 是隐性分配大户。

## GC 面（1.26）

- **Green Tea GC 默认开启**：扫描并行度提升，GC 开销普遍降 10–40%
  ——升 Go 1.26 本身就是一次 GC 优化（迁移剧本见 modern-go-versions）。
- `GOGC`（默认 100）调高 = 更少 GC 更大堆；`GOMEMLIMIT` 设堆上限
  防容器 OOM。两者是**部署参数**，代码侧的第一杠杆永远是减分配。
- `GODEBUG=gctrace=1` 观察周期与暂停；GC CPU 占比持续 >10% 才值得动。

## IO 与并发面

- 批量化：小 IO 合批（日志/DB 写缓冲）；网络往返合并。
- 有界并发压满下游（SetLimit 调参以目标 P99 为准，不是越并发越好）。
- 锁竞争：分片（N 路 shard map）或 `atomic` 换 `Mutex`——前提是
  mutex profile 证明竞争真实存在。

## 反模式清单

- 预防性优化（profile 里 <5% 的函数）。
- 牺牲正确性换性能：去锁、unsafe 指针戏法、依赖 map 迭代序。
- 微基准赢了负载输了仍合入。
- 无 benchstat 报告的"快了 X%"提交（评审直接打回，见
  benchmark-measurement）。
