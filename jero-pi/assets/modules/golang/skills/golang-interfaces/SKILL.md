---
name: golang-interfaces
description: 接口设计：接口定义在消费方（accept interfaces, return structs）、小接口组合、编译期断言 var _ I = (*T)(nil)、嵌入扩展。当设计接口、决定抽象边界或消除 mock 痛苦时使用。触发词：接口、interface、抽象、实现断言、mock、依赖倒置。
---

# 接口（Go）

管"接口是消费方的方言"：Go 的接口是隐式满足——谁用谁定义，先有实现后有抽象。

> **相关技能：** 泛型何时替代接口 → `golang-generics`；结构体与组合 → `golang-declarations`；依赖注入的接口边界 → `golang-project`。

## 何时使用

定义新接口、决定类型抽象层级、为测试解耦、评审"接口要不要拆"时使用。

## 核心要点

- **消费方定义**：接口写在用它的人旁边（`consumer.go` 里），不写在实现者旁边；生产方返回具体类型，消费方参数收接口——accept interfaces, return structs。
- **隐式满足是设计工具**：实现方不 import 消费方的接口包（无编译耦合）；跨包编译期断言 `var _ Consumer = (*Impl)(nil)` 兜住"以为实现了"。
- **小接口**：1–3 方法；大接口用组合（`type ReadWriter interface { Reader; Writer }`）；标准库的 `io` 家族是范本。接口越大，mock 越痛，误用面越宽。
- **不要提前抽象**：第二个实现出现之前不抽接口（YAGNI 的 Go 形态）；为一个实现造接口 + 一个 mock 是双重税。
- **方法集**：值接收者方法集 = 值+指针都满足接口；指针接收者只有指针满足——存进接口的是值还是指针决定能否调用，这里出问题编译器会教你。
- **nil 接口 vs 含 nil 指针的接口**：接口是（类型, 值）二元组；返回 `(*T)(nil)` 装进接口后 `!= nil`——typed-nil 陷阱的接口面（详见 `golang-errors` 的签名红线）。

## 红线

- 实现包里定义"我实现了什么"的接口（生产者侧接口）。
- 4+ 方法的"上帝接口"没有拆分理由。
- 为唯一实现配接口 + mock。

## 深读指路（references/）

接口全文（消费方模式/断言金样/组合样例/方法集矩阵）：`references/interface-design.md`。
