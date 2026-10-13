---
name: dotnet-nullable
description: 可空引用类型（NRT）：标注语义（? / NotNull / MaybeNull）、宽容运算符 ! 的豁免纪律、公共 API 边界与迁移策略。当启用/迁移 NRT 或评审 null 处理时使用。触发词：可空、nullable、NRT、NullReferenceException、null 检查。
---

# 可空引用类型（NRT）

NRT 把 null 从运行时炸弹变成编译期类型信息：标注是契约，不是装饰——`?` 表示"可能没有"，无标注表示"我保证有"。

> **相关技能：** 存量迁移 → `dotnet-upgrade`；API 边界设计 → `dotnet-api-design`。

## 何时使用

新项目启用 `<Nullable>enable</Nullable>`；存量项目分批迁移；评审 null 处理与 `!` 的使用密度时使用。

## 核心要点

- **新代码全量启用**：`csproj` 钉 `<Nullable>enable</Nullable>`；新文件 `#nullable enable` 逐文件迁移是合法路径。
- **标注即契约**：返回可能 null 用 `T?`；参数不接受 null 就不标；`NotNullWhen`/`MemberNotNull` 让 `TryXxx`/`IsXxx` 模式免冗余检查（`bool TryGet(out T? value)` + `[NotNullWhen(true)]`）。
- **宽容运算符 `!` 是豁免不是修复**：每处 `!` 要么改成流转正确的类型（`??` 抛/默认），要么注释说明为什么编译器看不出来。
- **晚初始化**：构造后必有值用 `required` 或 `Lazy<T>`；EF 导航属性用 `= null!` 是框架契约的已知豁免，集中注释。
- **数组/泛型标注**：`T?[]` 与 `T[]?` 语义不同；`where T : default` 约束解 `T?` 的 struct/reference 二义。
- **属性面板**：`AllowNull`/`DisallowNull`/`MaybeNull`/`NotNull` 处理读写字语义分离（setter 收 null 转 default）。

## 红线

- `<Nullable>disable</Nullable>` 回退（存量按文件推进，不做全局关灯）。
- 无注释的 `!` 连锁（同一变量连环 `!` 是流转没理顺）。
- `string?` 参数不做检查直接传给 `string` 参数（把炸弹下推给调用方）。

## 深读指路（references/）

标注语义、迁移剧本与属性全家桶：`references/nullable-reference-types.md`。
