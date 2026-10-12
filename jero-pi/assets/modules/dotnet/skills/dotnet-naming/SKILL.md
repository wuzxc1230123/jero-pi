---
name: dotnet-naming
description: 命名决策树：PascalCase/camelCase 分面、接口 I 前缀、异步 Async 后缀、布尔 Is/Has/Can、缩略词与泛型参数。当命名类/方法/参数/测试或评审命名一致性时使用。触发词：命名、取名、PascalCase、camelCase、命名规范。
---

# 命名（C#/.NET）

名字是 API 的第一文档：大小写约定表意访问级别与种类，命名冲突时先怀疑设计再怀疑名字。

> **相关技能：** 风格底线 → `dotnet-style`；公共 API 面设计 → `dotnet-api-design`。

## 何时使用

命名新的类型/方法/参数/测试，或评审命名一致性（含 `dotnet format` 命名分析器覆盖不到的语义面）时使用。

## 核心要点

- **大小写分面**：类型/方法/属性/常量/枚举值 PascalCase；参数/局部变量 camelCase；私有字段 `_camelCase`；接口 `I` 前缀（`IDisposable`）。
- **异步方法**：返回 `Task`/`ValueTask` 的公共方法带 `Async` 后缀（`ReadAsync`）；同型同步/异步并存时成对命名。
- **布尔**：属性/方法用 Is/Has/Can/Allows 开头（`IsEmpty`、`HasValue`）；肯定式命名——`IsEnabled` 优于 `IsNotDisabled`。
- **缩略词**：两字母全大写（`IO`/`DB`），两字母以上首字母大写（`Xml`/`Html`/`Id`）——`ID` 与 `Id` 的历史分叉以框架用法（`Id`）为准。
- **泛型参数**：`T` 单类型；描述角色用 `TKey`/`TValue`；约束语义进名字（`TEntity where TEntity : class`）。
- **不缩写领域词**：`CalculateGrossTotal` 不写 `CalcGT`；名字长度与作用域成正比（循环变量 `i`，类级 `totalItemCount`）。

## 红线

- 匈牙利前缀（`strName`/`intCount`）与下划线分隔的类型名（`my_class`）。
- `Manager`/`Helper`/`Utils` 后缀类名——职责不清的信号（重命名前先问该不该拆）。
- 数字尾缀消歧（`data2`）——按语义命名或重构结构。

## 深读指路（references/）

命名决策树与框架约定全文：`references/naming-conventions.md`。
