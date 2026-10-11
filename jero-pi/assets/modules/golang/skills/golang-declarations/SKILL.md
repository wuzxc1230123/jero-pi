---
name: golang-declarations
description: 声明与初始化：var 与 := 的选择、分组声明、复合字面量、iota 枚举、作用域与变量遮蔽。当声明变量/常量/类型、排查 shadowing 或写枚举时使用。触发词：声明、初始化、var、短变量声明、iota、枚举、遮蔽、shadowing。
---

# 声明与初始化（Go）

管"值从哪来、活在哪"：声明方式的选择暴露对作用域的理解，遮蔽是 Go 里最阴的读错来源。

> **相关技能：** 风格底线 → `golang-style`；零值可用性与边界拷贝 → `golang-defensive`；数据结构选型 → `golang-data-structures`。

## 何时使用

声明变量/常量/类型、写枚举、排查"改了变量但没生效"类 bug（十有八九是遮蔽）时使用。

## 核心要点

- **var vs :=**：零值即可用或需显式类型时用 `var x T`；有初始化表达式且类型显然时用 `:=`；函数外只有 `var`。
- **零值是有用的**：`var b bytes.Buffer`、`var mu sync.Mutex` 直接用；不给"以防万一"的显式初始化（`x := ""` 是噪音）。
- **分组声明**：`const`/`var` 块按语义分组；iota 枚举显式写类型 `type Kind int` + 首成员 `KindZero Kind = iota`，跳值用 `_`。
- **复合字面量**：结构体初始化写字段名（`User{Name: n}`），不靠位置；嵌套用字面量不逐字段赋值。
- **遮蔽（shadowing）**：内层作用域重声明外层名字——`if err := f(); err != nil` 在多数场景是惯用简洁，但在需要给外层 `err` 赋值时是陷阱；`:=` 要求左侧至少一个新变量，`err` 老变量被静默复用还是新建取决于同伴。
- **类型别名 vs 定义**：`type A = B` 是别名（可互换），`type A B` 是新类型（需转换）；选错会悄悄改变方法集可用性。

## 红线

- 依赖未初始化的 nil map/slice"碰巧能跑"（nil map 读可以写会 panic——写前必须 make）。
- 在循环体内声明本应在循环外复用的重资源（DB 连接、encoder）。
- 用 `_` 丢弃 error 且无注释豁免。

## 深读指路（references/）

声明全文（var/:= 决策树/iota/字面量/遮蔽案例）：`references/declarations-scope.md`。
