# 切片与映射底层（slices-maps-internals）

> 来源：Go Blog "Go Slices: usage and internals" / "The Go memory model"（经两套快照派生）；权威级：规范
> 最低 Go 版本：1.23（迭代器）｜ 核验日期：2026-10 ｜ 授权账本：`_sources.md`

## slice 三元组

```
type slice struct { array unsafe.Pointer; len int; cap int }
```

- `s = append(s, x)`：cap 足够 → 原地写（len+1）；不够 → 新底层数组
  拷贝扩容（约 2 倍策略）。**结果必须回赋**——不回赋时旧 len 不变，
  且写入可能已污染共享底层数组（别名 bug）。
- 扩容后 `&s2[0] != &s1[0]`：持有元素指针的代码在 append 后失效。

## 子切片是视图

```go
big := make([]byte, 1<<20)
tail := big[1<<19:]        // tail 共享 big 底层数组
_ = tail                    // big 的后一半钉住整个 1MB（无法回收前半）
small := slices.Clone(big[10:20])   // 要释放大数组：克隆脱钩
```

API 收到子切片要"持有"时（异步/缓存），先 `slices.Clone`——
所有权语义见 defensive-boundaries 的拷贝矩阵。

## map

- 哈希表 + bucket；增长重哈希（渐进式）；**删除不缩容**（内存敏感
  场景的大 map 定期重建）。
- **迭代顺序随机**（规范保证）：既不是插入序也不是排序序；需要有序
  迭代：取 `slices.Sorted(maps.Keys(m))`（1.23+）。
- **并发读写 fatal panic**（不可 recover）：要么 `sync.Mutex` 护，
  要么 `sync.Map`（键稳定读多写少），见 sync-primitives 选型。
- 预知大小 `make(map[K]V, n)` 一次到位减少再哈希。
- set 形态 `map[T]struct{}`（零内存值语义）；判定 `_, ok := m[k]`。

## nil vs 空

| 容器 | nil 读 | nil 写 | 判等 |
|---|---|---|---|
| `var s []T` | 安全（len=0，range 空转） | append 合法（就地成长） | `len(s) == 0` |
| `var m map[K]V` | 安全（查返回零值） | **panic**（先 make） | `len(m) == 0` |
| `make([]T, 0)` | 同上 | 同上 | 同上 |

项目约定二选一并一致：返回"无结果"用 nil；字段空集合初始化空——
在包注释声明。

## 迭代器（1.23+）

```go
func Items(m map[K]V) func(yield func(K, V) bool) { ... }
for k, v := range Items(m) { ... }   // range over func
```

- 迭代器暴露只读视图不拷贝底层——替代"返回内部 slice"的防御形态。
- `slices.Collect`/`maps.Collect` 从迭代器物化。

## 数组与值语义

- `[N]T` 是值类型（赋值全拷贝）；`[]T` 是引用头。函数参数传数组 =
  全量拷贝，几乎总该传 slice。
- 字符串 ↔ 字节：`[]byte(s)` 分配拷贝；热路径避免反复转换，
  `strings.Builder` 与 `unsafe.String`（明确边界时）是替代面。

## 逃逸与分配（联 performance）

- 返回局部 slice/map 指针 → 堆逃逸；编译器诊断
  `go build -gcflags=-m`（详见 pprof-profiling / performance-playbook）。
- 装箱接口 `[]any` 每元素一次分配——泛型（见 generics-constraints）
  是零装箱替代。
