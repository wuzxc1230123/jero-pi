---
name: golang-data-structures
description: 切片与映射底层机制：选型决策树、append 别名、nil vs 空、map 迭代随机性、map set、泛型容器。当选择容器、排查切片别名 bug 或优化容器用法时使用。触发词：切片、slice、数组、映射、map、append、别名、底层数组、set。
---

# 数据结构（Go）

管"容器的内存语义"：切片是视图、map 是指针——不懂底层语义的容器用法全是隐性 bug。

> **相关技能：** 边界拷贝纪律 → `golang-defensive`；泛型容器与标准库工具 → `golang-generics`；容器热点优化 → `golang-performance`。

## 何时使用

选择 slice/map/array、写 append 逻辑、排查"数据莫名被改"（别名）、做 set 或优化容器分配时使用。

## 核心要点

- **选型树**：定长 → array；变长序列 → slice；键值查找 → map；去重/成员判断 → `map[T]struct{}`（比 `map[T]bool` 省内存且语义准）；只读小集合（<~10）线性扫描 slice 常更快。
- **slice 三元组**：指针+len+cap；`append` 可能原地写（cap 足够）或新分配（cap 不够）——两个切片共享底层数组时，一方的 append 写穿另一方；结果必须回赋：`s = append(s, x)`。
- **子切片是视图**：`s[a:b]` 共享底层数组；持有小尾巴会钉住整个大数组（内存泄漏形态），要释放用 `slices.Clone(s[a:b])`。
- **map**：迭代顺序随机（语言规范级随机，绝不依赖）；并发读写直接 panic（fatal，recover 不了）；删除不缩容；预知大小 `make(map[K]V, n)` 减少再哈希。
- **nil vs 空**：nil slice/map 读操作安全（len=0、查找返回零值）、写操作 map panic；函数返回"无结果"用 nil、字段"空集合"用初始化空——项目内选定一种并一致。
- **new vs make**：make 只给 slice/map/channel（初始化内部结构）；new(T) 给 T 的指针。容器结构 `var s []T` 零值即可用，不需要 `make([]T, 0)` 起手。

## 红线

- map 并发读写（含"读多写少"的侥幸）——要么锁要么 `sync.Map`（键稳定、读多写少场景）。
- 依赖 map 迭代顺序。
- append 结果不回赋；子切片长持大数组。

## 深读指路（references/）

容器全文（底层图解/append 扩容表/set 模式/逃逸与分配）：`references/slices-maps-internals.md`。
