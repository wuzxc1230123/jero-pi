---
name: dotnet-serialization
description: System.Text.Json 契约：源生成（AOT/启动性能）、命名策略与必填成员、多态与自定义转换器、不可信输入防线。当设计 JSON 契约或评审序列化代码时使用。触发词：序列化、反序列化、System.Text.Json、JSON、JsonSerializer、源生成、转换器。
---

# 序列化（System.Text.Json）

JSON 契约是公共 API 的等价物：命名策略、null 语义与版本演进一旦发布就是兼容面——反射默认走便捷，源生成走纪律。

> **相关技能：** AOT/裁剪兼容 → `dotnet-aot`；Web API 契约面 → `dotnet-webapi`；配置绑定 → `dotnet-configuration`。

## 何时使用

设计 DTO 的 JSON 形状、选反射或源生成、写自定义转换器、处理不可信输入时使用。

## 核心要点

- **源生成是默认答案**：`JsonSerializerContext` 派生类（`[JsonSerializable(typeof(Order))]`）零反射（AOT 兼容 + 启动提速）；反射实例 `JsonSerializerOptions` 留给动态形状或工具脚本。
- **契约显式化**：`JsonSerializerOptions` 统一 `PropertyNamingPolicy = JsonNamingPolicy.CamelCase`、`DefaultIgnoreCondition`；DTO 上 `JsonPropertyName`/`JsonExtensionData`（前向兼容未知字段）；`required` 成员映射 JSON 必填（.NET 8+ 的 `respect nullable annotations` 链路）。
- **多态有开关**：`[JsonPolymorphic]` + `[JsonDerivedType]` 显式声明类型鉴别器——不可信输入的多态反序列化是攻击面，鉴别器白名单内建。
- **转换器窄用**：`JsonConverter<T>` 处理值类型/第三方类型（`JsonStringEnumConverter<T>` 语义化枚举）；转换器内 `Utf8JsonReader/Writer` 直读直写，不递归回 `JsonSerializer` 死循环。
- **流式大文档**：`JsonSerializer.DeserializeAsyncEnumerable`（NDJSON）与 `JsonDocument`/`JsonNode` DOM 按需取；超大文档不整体 `Deserialize<T>`。
- **不可信输入**：`JsonSerializerOptions.MaxDepth`/`GraphNode` 限制；不反序列化到 `object`/多态根（见多态开关）；错误信息不带原文回显。

## 红线

- `Newtonsoft.Json` 混用于同一契约（行为差异：大小写/日期/引用循环——统一栈）。
- AOT 目标里裸反射序列化（裁剪后炸在运行时）。
- 循环引用无 `ReferenceHandler` 处理就 Serialize。

## 深读指路（references/）

契约/源生成/转换器谱系：`references/serialization-json.md`。
