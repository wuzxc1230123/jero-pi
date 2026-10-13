# API 设计（api-design）

> 来源：Framework Design Guidelines / dotnet-skills csharp-api-design 与 csharp-coding-standards 快照；权威级：规范
> 锚定运行时：.NET 10 / C# 14 ｜ 核验日期：2026-10 ｜ 授权账本：`_sources.md`

## 第一原则

调用方的每行代码编译进你的签名。类型系统能检查的绝不留给文档：
参数类型收窄到"非法状态不可表示"，错误路径在签名上可见。

## 值对象与强类型

```csharp
public readonly record struct CustomerId
{
    public Guid Value { get; }
    private CustomerId(Guid value) => Value = value;
    public static CustomerId Create(Guid value)
        => value == Guid.Empty
            ? throw new ArgumentException("empty guid", nameof(value))
            : new CustomerId(value);
}
```

- 原始类型偏执（`string`/`Guid`/`int` 传一切 ID）的代价：参数可
  交换（`SwapBytes(a, b)` 编译过）、单位丢失（`ms`/`TimeSpan`）、
  校验散布。值对象一次性付清。
- `readonly record struct` 小值零堆分配；`record class` 引用语义
  大载体。
- 智能构造（私有构造 + `Create`/`TryCreate`）把不变式钉在类型里。

## 签名设计

- **参数数量**：>3 个收参数对象（`SearchOptions`）；布尔裸参数
  禁止（`Send(compress: true)` 可读，`Send(true)` 不——枚举
  `SendFlags.Compress` 或选项对象）。
- **Try 模式**：可预期失败 `bool TryGetXxx(out T? value)` +
  `[NotNullWhen(true)]`；异常留给"不该发生的"。
- **Span 友好重载**：热路径 `Parse(ReadOnlySpan<char>)` + `string`
  便捷重载（隐式转换自动命中 span 版）；跨 await 用 `Memory<T>`/
  `ReadOnlyMemory<T>`。
- **默认值与可选**：参数默认值兼容新增（追加不破坏）；`params`
  收尾（C# 13 起 `params` 支持跨集合类型）。
- **返回类型**：集合返回 `IReadOnlyList<T>`（有随机访问语义）或
  `IEnumerable<T>`（仅流式）——暴露面最小化；异步返回
  `Task<T>`/`ValueTask<T>` 按 async-patterns 取舍。
- **泛型约束表达意图**：`where T : class, IComparable<T>` 比运行时
  类型检查好；静态抽象接口（`INumber<T>` 谱系）泛型数学替代
  per-type 重载。

## 接口设计

- 接口定义在消费方（需求驱动），实现细节不出现在接口面（CQS：
  查询与命令分离）。
- 显式接口实现窄化公共面：`List<T>` 的 `ICollection<T>.Add` 抛
  `NotSupportedException`（只读包装的合法姿势）。
- 接口默认成员只用于版本演进；不要当 trait/mixin 用。
- `IDisposable`/`IAsyncDisposable` 是生命周期契约：注入者声明它 =
  所有权转移的文档（谁 new 谁 Dispose——容器管理例外）。

## 版本化与演进

- 破坏性变更（删成员/改签名/改语义）走新类型/新方法 +
  `[Obsolete("Use Xxx2 …", DiagnosticId = "CC0001")]` 带迁移指引；
  `Xxx2` 是最后的手段（先用重载/命名空间分流）。
- 行为变更也是破坏：同名方法在修复版本改变异常语义/时序，消费方
  依赖文档语义——变更写进 release notes 并升主版本（类库）。
- 序列化契约面（DTO）的演进规则见 serialization-json（未知字段
  容忍/必填语义）。

## 误用防御

- 参数校验先行：`ArgumentException.ThrowIfNullOrEmpty(name)`/
  `ArgumentNullException.ThrowIfNull(x)` 一行收口，别手拼。
- 静态可变状态不进公共 API（隐式全局耦合，测试地狱）。
- 返回内部可变集合 = 状态泄漏：防御性拷贝（`[.. _items]`）或
  `IReadOnlyList` + `AsReadOnly()`。
- `object`/`dynamic` 参数：类型检查推迟到运行时——泛型/重载/
  判别联合（sealed 层次 + 模式匹配）。

## 错误面

- 异常类型可区分（`OrderNotFoundException` vs `TimeoutException`），
  消费方 catch 语义块而非 catch-all。
- 错误信息带参数名与非法值（安全脱敏后）；`Exception` 链保留
  （`throw;` 不 `throw ex;`）。
- Result 模式（`OneOf` 谱系/自定义判别联合）在"失败是常态"的
  域（解析/校验/外部调用）替代异常控制流——团队统一一种。

## 红线

- 公共 API 暴露 `List<T>` 可变引用、`Task` 裸字段、`CancellationToken`
  缺失的异步签名。
- 重载仅在参数名不同的同位置（调用方选不出来的重载）。
- `sealed` 缺席的公共类（默认 `sealed`，开放继承是决策——见
  Framework Design Guidelines 继承或组合节）。
