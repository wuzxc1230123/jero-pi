# 可空引用类型（nullable-reference-types）

> 来源：Microsoft Learn NRT 文档 / dotnet-skills nrt 篇 / dotnet-skills 仓库 migrate-nullable-references 剧本（经两快照派生）；权威级：规范
> 锚定运行时：.NET 10 / C# 14 ｜ 核验日期：2026-10 ｜ 授权账本：`_sources.md`

## 模型

`#nullable enable` 后引用类型的"可空性"进入类型系统：`T` 表示"我
保证非 null"，`T?` 表示"可能没有"。这是编译期流分析（flow analysis）
而非运行时检查——`null` 进 `T` 运行时照炸，NRT 是把约定升级成机器
可验的契约。

## 标注语义

| 构造 | 含义 |
|---|---|
| `T?`（引用类型） | 可为 null 的引用 |
| `T?`（值类型约束 `where T : struct`） | `Nullable<T>` |
| `T?`（无约束泛型） | "default 可空"——`T?` 解引用前判 `is null` |
| `default` 字面量 | 显式承认"无值"，与 `?` 联用 |

## 后置属性全家桶

```csharp
bool TryGetOrder(int id, [NotNullWhen(true)] out Order? order)
    => (order = _store.Find(id)) is not null;

string? _cache;
[MemberNotNull(nameof(_cache))]
void Warm() => _cache = Build();
```

- `NotNullWhen(bool)`：返回真则该参数/输出非空——`Try`/`Is` 模式
  免冗余检查的关键。
- `MemberNotNull/MemberNotNullWhen`：方法调用后字段非空——惰性
  初始化的机器契约。
- `AllowNull/DisallowNull`：读写语义分离（setter 收 null 存 default，
  getter 永不还 null）。
- `MaybeNull/NotNull`（返回值）：旧 API 的边缘标注，新代码少用。

## 宽容运算符 `!`

- 语义是"我（开发者）向编译器担保此处非空"——担保错了运行时炸，
  编译器免责。
- 纪律：每处 `!` 必须二选一——改成流转正确的构造（`?? throw`、
  `ArgumentNullException.ThrowIfNull`、后置属性），或行尾注释说明
  编译器为何看不穿（框架契约、互操作边界）。
- 连环 `!`（同一表达式两次以上）= 流转没理顺，回炉。

## 已知豁免面（集中注释）

- EF Core 导航属性：`public Order Order { get; set; } = null!;`——
  框架在查询物化时赋值；集中一处注释 + 团队共识，不散装。
- 序列化 DTO：构造器/初始化器由反序列化器填充（`required` 已能
  覆盖多数场景，优先 `required`）。
- 互操作/反射边界：入口处 `ThrowIfNull` 收口。

## 迁移剧本（存量项目）

1. `<Nullable>annotations</Nullable>`：只标注不报错（公共 API 面
   先行——标注即契约，越早发布越少破坏）。
2. 新文件全 `#nullable enable`；按目录逐批改 `warnings` 并清零。
3. `<Nullable>enable</Nullable>` 全局收口；`#nullable disable` 的
   孤岛要有清单与退出时间。
4. 每步全量构建 + 测试（`verification-gates`）；公共库发带标注的
   次版本（消费方 `LangVersion` 足够即可受益）。

## 与新运行时特性的协作

- `ArgumentNullException.ThrowIfNull(x)`（.NET 6+）一行收参数检查
  （还带 caller 参数名）。
- `required` 成员消灭"构造后未初始化"类 null 面（modern-csharp）。
- `InvalidOperationException.ThrowIfNull`（.NET 10）/`ThrowIf` 族
  语义化抛出。

## 红线

- `<Nullable>disable</Nullable>` 全局回退（按文件推进）。
- 无注释豁免的 `!`；`string?` 收进来不加检查转手传给 `string`
  签名（炸弹下推）。
- 把 NRT 当运行时防护（它不拦截反射/序列化塞进来的 null——边界
  校验照做）。
