---
name: golang-generics
description: 泛型使用纪律：先具体类型、第二个类型出现再泛化；constraint 设计与组合；泛型与接口的选型；Go 1.26 自引用约束解禁。当写类型参数、设计 constraint 或决定泛型 vs 接口时使用。触发词：泛型、generics、类型参数、constraint、类型约束、any。
---

# 泛型（Go）

管"泛型是偿还重复债务的工具，不是抽象竞技场"：Go 泛型的纪律是"写两遍再泛化"。

> **相关技能：** 接口抽象的边界 → `golang-interfaces`；数据结构底层 → `golang-data-structures`；标准库泛型工具（slices/maps）直接用 → 本技能要点。

## 何时使用

写/改类型参数函数或类型、设计 constraint、评审"要不要泛化"时使用。

## 核心要点

- **先具体后泛化**：第一次写具体类型，第二次重复出现再抽类型参数；"未来可能用"不是泛化理由——constraint 一旦发布就是 API。
- **标准库优先**：`slices`/`maps` 包（Contains/Sort/Clone/Keys 等）覆盖大多数场景；手写泛型循环前先查标准库。
- **constraint 最小化**：只要 `comparable` 不写 `any`；只要 `~int|~int64` 不写 `Integer` 大联盟；constraint 写在标准位置（`[T constraints.Ordered]` 或内联 `[T ~int | ~float64]`），组合用接口 `interface { Number; String() }`。
- **Go 1.26 自引用解禁**：`type Ordered[T any] interface { ... }` 中约束引用自身参数类的自指形态不再是编译错误——迁移存量 workaround 时逐处验证。
- **泛型 vs 接口**：数据结构/算法对多类型复用 → 泛型（编译期特化、零装箱）；行为多态 → 接口（运行期、可 mock）；"泛型接口替代一切"两头都做不好。
- **不要为单调用点泛化**：类型参数只在 ≥2 个真实调用点摊薄成本；一个调用点的泛型是负资产。
- **any 是逃生舱不是默认**：`any` 参数 + 类型 switch 通常是接口或泛型的误用形态。

## 红线

- 为单一调用点/单一类型引入类型参数。
- constraint 比需要宽（`any` 起手）。
- 泛型 + 反射混合做"超级工厂"。

## 深读指路（references/）

泛型全文（决策树/constraint 设计/标准库泛型盘点/1.26 变化）：`references/generics-constraints.md`。
