---
name: dotnet-language
description: 现代 C# 特性选型：record 与不可变性、模式匹配、primary constructor、collection expressions、readonly struct——用对的特性而不是新的特性。当引入 C# 12–14 特性或评审语言用法时使用。触发词：record、模式匹配、主构造函数、集合表达式、C# 14、语言特性。
---

# 现代 C# 特性选型

特性是工具不是 KPI：每个新特性都有它解决的问题与引入的复杂度，选型看问题形状，不看发布日期。

> **相关技能：** 可空标注 → `dotnet-nullable`；值对象与 API 面 → `dotnet-api-design`；性能取舍 → `dotnet-performance`。

## 何时使用

写新代码时选择语言构造（record vs class、switch 表达式 vs if 链、primary constructor vs 显式字段）；评审语言用法是否到位时使用。

## 核心要点

- **不可变优先**：数据载体用 `record`（值相等 + `with` 表达式 + 解构）；可变状态是显式决策（`class` + 注明理由）。
- **模式匹配**：`switch` 表达式处理封闭分类；类型/属性/关系模式替代 as-cast 链；`if (obj is Foo f)` 收窄类型。
- **primary constructor（C# 12）**：注入与简单载体直接 `class Foo(Bar bar)`；参数被多方法捕获或需可变时回显式字段——隐式捕获放大重构成本。
- **collection expressions（C# 12）**：`int[] xs = [1, 2, 3];`、`..` 展开；目标类型推断统一初始化面。
- **字段与成员**：`required` 成员强制初始化（替代构造器爆炸）；`init` 只 setter；C# 14 `field` 关键字解属性支撑字段校验。
- **readonly struct / readonly member**：防御性拷贝的解药；`in` 参数只在大于指针尺寸的 readonly struct 上有意义。

## 红线

- 为用新特性重写稳定代码（无行为收益的机械迁移）。
- `dynamic`（动态派发丢弃编译期检查）——反射/泛型/多态是正解。
- 隐式捕获的 primary constructor 参数参与 `partial` 多文件。

## 深读指路（references/）

特性谱系与逐版本选型（C# 12–14）：`references/modern-csharp.md`。
