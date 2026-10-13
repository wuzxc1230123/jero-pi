# 序列化（serialization-json）

> 来源：dotnet-skills serialization 快照 / dotnet-skills 仓库 system-text-json-net11（经 skills-main 快照派生）/ Microsoft Learn System.Text.Json 文档；权威级：规范
> 锚定运行时：.NET 10（System.Text.Json 10） ｜ 核验日期：2026-10 ｜ 授权账本：`_sources.md`

## 双模式：反射 vs 源生成

| 模式 | 形态 | 场景 |
|---|---|---|
| 反射 | 运行时按类型元数据 | 工具脚本/动态形状/快速原型 |
| 源生成（AOT） | `JsonSerializerContext` 派生类 | 一切正式代码（AOT 兼容 + 启动零反射开销） |

```csharp
[JsonSerializable(typeof(Order))]
[JsonSerializable(typeof(List<Order>))]
public sealed partial class AppJsonContext : JsonSerializerContext;

JsonSerializer.Serialize(order, AppJsonContext.Default.Order);
await JsonSerializer.DeserializeAsync(stream, AppJsonContext.Default.ListOrder, ct);
```

- 源生成的 `TypeInfo` 预烘焙：裁剪安全（aot-trimming）、启动无反
  射成本、`Native AOT` 唯一可行路径。
- 反射模式 + AOT = 运行时炸（`MissingMetadataException`）——AOT
  目标里反射序列化是红线。

## 契约面

```csharp
public sealed record OrderDto
{
    public required string Id { get; init; }
    [JsonPropertyName("created_at")]
    public DateTimeOffset CreatedAt { get; init; }
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? Note { get; init; }
    [JsonExtensionData]                    // 前向兼容：未知字段进背包
    public Dictionary<string, JsonElement>? Extra { get; init; }
}
```

- 命名策略全局统一（options 层 `PropertyNamingPolicy = CamelCase`/
  `SnakeCaseLower`），DTO 上 `JsonPropertyName` 只钉跨系统契约的
  不规则名。
- **发布即兼容面**：加字段（消费方容忍）安全；删字段/改类型/改
  语义是破坏性变更（版本化策略见 aspnet-webapi）。
- `required` 成员 → 缺键反序列化即失败（机器可验的必填契约）；
  可选面 `?` 类型 + 忽略条件。
- `JsonExtensionData` 背包：旧版本读新版本不丢数据（回写场景）。

## 反序列化防线（不可信输入）

- **多态有开关**：`[JsonPolymorphic(TypeDiscriminator = "$type")]`
  + `[JsonDerivedType(typeof(DerivedA), "a")]` 显式白名单——无标
  注的类型不参与多态反序列化（Gadget 攻击面的根防御）。
- 深度限制（`MaxDepth` 默认 64）与大小限制（流式读时自控 buffer）
  防炸栈/炸内存。
- 错误处理：`JsonException` 带行列号；`try-catch` 边界收口，错
  误信息不回显原文全文（日志脱敏）。
- 枚举走 `JsonStringEnumConverter<T>`（语义化字符串）——数字枚
  举的成员重排即静默错值。

## 转换器（JsonConverter<T>）

```csharp
public sealed class CustomerIdConverter : JsonConverter<CustomerId>
{
    public override CustomerId Read(
        ref Utf8JsonReader r, Type t, JsonSerializerOptions o)
        => CustomerId.Create(r.GetString()!);          // 值对象内建校验

    public override void Write(
        Utf8JsonWriter w, CustomerId v, JsonSerializerOptions o)
        => w.WriteStringValue(v.Value.ToString());
}
```

- 适用：值对象/第三方类型/非标准格式（自定义日期/紧凑编码）。
- 转换器内直接 `Utf8JsonReader/Writer`——不递归回 `JsonSerializer.
  Serialize`（栈溢出）；需要子对象序列化用 `options.GetConverter
  <T>()` 链式。
- 转换器进 `JsonSerializerContext`（`[JsonConverter]` 属性挂类型/
  成员）保持 AOT 面。

## 流式与大文档

- `DeserializeAsyncEnumerable<T>(stream)`：NDJSON/大流逐条处理
  （背压天然）。
- `JsonDocument.Parse`（`using` 归还缓冲）DOM 只读探查；
  `JsonNode` 可变 DOM（小文档补丁）——大文档不整体 `Deserialize
  <T>`。
- `SerializeAsync` 直写流/`Serialize` 直写 `Utf8JsonBufferWriter`
  谱系免中间串（performance-engineering 的分配面）。

## 性能要点

- `JsonSerializerOptions` 复用单例（首次使用烤元数据缓存；每次
  new options = 每次重烤）——options 做成 static readonly 或 DI
  注入。
- 源生成模式的 fast-path（`JsonTypeInfoResolver` 组合）；`ReadAsSpan
  (bytes)` 谱系零字符串直解（框架内部惯技，业务层少直接用）。
- UTF-8 字节路径优于 string（`JsonSerializer.SerializeToUtf8Bytes`）
  ——HTTP 响应直写。

## 红线

- Newtonsoft.Json 混用于同一契约（大小写/日期/引用循环语义差异
  是数据事故源——统一栈）。
- AOT 目标裸反射序列化；多态反序列化无白名单声明。
- 循环引用无 `ReferenceHandler.IgnoreCycles/Preserve` 处理就
  Serialize（自引用对象图直接炸）。
