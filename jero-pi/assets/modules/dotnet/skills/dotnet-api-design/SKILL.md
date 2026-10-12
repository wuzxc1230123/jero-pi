---
name: dotnet-api-design
description: API 设计：面向领域的强类型、值对象与智能构造、Span 友好重载、Try 模式、避免 bool 参数陷阱、版本化与 Obsolete 纪律。当设计公共 API 或评审接口签名时使用。触发词：API 设计、接口签名、值对象、Try 模式、公共 API、向后兼容。
---

# API 设计（C#/.NET）

公共 API 是一次成型的承诺：调用方的每处代码都编译进你的签名——类型系统能检查的绝不留给文档。

> **相关技能：** 现代 C# 载体（record/required） → `dotnet-language`；性能敏感面 → `dotnet-performance`。

## 何时使用

设计新类型/接口/公共方法的签名；评审 API 的可用性、类型安全与演进路径时使用。

## 核心要点

- **强类型面向领域**：原始类型偏执（`string` 传一切 ID）改值对象——`readonly record struct CustomerId(Guid Value)` 零成本表达语义；智能构造（`CustomerId.Create` 校验）把非法状态变不可表示。
- **Try 模式**：可失败查询用 `bool TryGetXxx(out T value)` + `[NotNullWhen(true)]`；抛异常留给真正的异常态（不该发生的），可预期失败返回结果。
- **避免 bool 参数陷阱**：`Send(true, false)` 无人能读——改枚举（`SendOptions.Compress`）或选项对象（`SendOptions`）；三个以上参数收选项/参数对象。
- **Span 友好重载**：热路径提供 `ReadOnlySpan<char>` 重载 + `string` 便捷重载（`string` 隐式转 span 自动命中）；`Memory<T>` 跨 await 边界。
- **显式接口实现**：同名成员多接口冲突与"窄化公共面"（`ICollection<T>.Add` 在只读集合上显式抛 `NotSupportedException`）。
- **演进纪律**：破坏性变更新路并行（`Xxx2` 是最后的手段）；`[Obsolete]` 带迁移指引（`MessageId` 可控报错）；参数默认值与 `params` 扩展是兼容面。

## 红线

- 公共 API 返回内部可变集合的引用（防御性拷贝或 `IReadOnlyList<T>`）。
- `object`/`dynamic` 参数把类型检查推迟到运行时。
- 静态可变状态进公共 API 面（隐式全局耦合）。

## 深读指路（references/）

签名设计、值对象与演进模式全文：`references/api-design.md`。
