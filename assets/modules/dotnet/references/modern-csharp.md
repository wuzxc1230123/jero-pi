# 现代 C# 特性（modern-csharp）

> 来源：Microsoft Learn C# 12/13/14 文档 / dotnet-skills csharp-coding-standards 快照；权威级：规范
> 锚定语言级：C# 12–14（.NET 8–10） ｜ 核验日期：2026-10 ｜ 授权账本：`_sources.md`

## 特性选型决策树

```
要解决什么？
├─ 数据载体 + 值语义 → record（positional 或 init 集）
├─ 封闭分类多分支 → switch 表达式 + 模式匹配
├─ 注入/简单初始化样板 → 主构造函数（C# 12）
├─ 集合初始化统一 → collection expressions [..]（C# 12）
├─ 强制初始化不变式 → required 成员（C# 11）
├─ 属性支撑字段带校验 → field 关键字（C# 14）
├─ 静态方法添语法糖 → extension members（C# 14）
└─ 性能敏感小结构 → readonly record struct / readonly struct
```

## record 谱系

- `record Person(string Name, int Age)`：值相等、`with` 非破坏复制、
  `Deconstruct`、`ToString` 免费打印。
- 可变性是显式决策：`record` + `set` 可变属性合法但放弃默认不可变
  心智；`record struct` 值语义上栈（小、密集分配）。
- 继承：`record` 可继承（`sealed` 收口默认）；`record struct` 不可。
- 载体含不变式时：私有构造 + 静态工厂 `Create`（校验）+ positional
  转内部存储（见 api-design）。

## 模式匹配

```csharp
var rate = subscriber switch
{
    { Plan: Plan.Enterprise, Months: > 36 } => 0.15m,
    { Plan: Plan.Enterprise } => 0.10m,
    { Months: > 12, Referral: true } => 0.05m,
    _ => 0m,
};
```

- 属性模式 + 关系模式 + 逻辑模式（`and`/`or`/`not`）覆盖大多数
  分类分支；穷尽性靠 `_` 丢弃模式兜底（枚举穷尽由编译器在新版本
  提示，仍以 `_` 防未来新增成员）。
- `is` 声明模式收窄：`if (shape is Circle { Radius: > 10 } big)`。
- 列表模式（`[1, .. var rest, 5]`）解序列头尾。

## 主构造函数（primary constructor，C# 12）

```csharp
public sealed class OrderValidator(IInventory inventory, TimeProvider clock)
{
    public bool CanFulfill(Order o) => inventory.Has(o.Sku, o.Qty);
}
```

- 参数直接进成员引用；未显式声明的捕获是隐式字段——重构放大器。
- 需要可变字段、多构造、partial 分文件、参数参与接口实现时回显式
  构造。
- `readonly` 语义要显式字段承接（隐式捕获不可再赋值但可被外部观察
  的面窄）。

## collection expressions（C# 12）

```csharp
int[] xs = [1, 2, 3];
List<int> ys = [.. xs, 4];
ReadOnlySpan<int> zs = [1, 2];
```

- 目标类型统一初始化（数组/List/Span/ImmutableArray/自定义支持
  `CollectionBuilder`）；`..` 展开任意 `IEnumerable` 与集合。

## required 与 init（C# 11+）

- `required string Name { get; init; }` 强制对象初始化器补齐，替代
  多构造重载矩阵；`SetsRequiredMembers` 私有构造桥接。
- `init` 只在构造期可写——不可变性的最小形态。

## C# 14 面板

- `field` 关键字：属性内直接读写支撑字段（校验/惰性初始化不再手写
  私有字段双轨）。
- 扩展成员：静态非泛型类内 `extension(Type receiver)` 块声明扩展
  属性/静态成员——替代"只能扩展方法"的历史限制。
- null 条件赋值（`obj?.Prop = value`）与 `nameof` 未绑定泛型增强。

## 性能与语言边界

- 语言特性不背性能锅也不送性能礼：`record struct` vs `record` 的
  分配差异、模式匹配的编译产物（跳转表 vs 顺序比较）——结论一律
  基准说话（benchmark-measurement）。
- `dynamic` 退出通用代码（互操作边界除外）；函数式风格（LINQ/不可
  变）与热路径手写循环分层使用（performance-engineering）。

## 红线

- 为尝鲜重写稳定代码；`partial` 类拆散主构造函数。
- 用反射/表达式树模拟已有语言特性（源生成器才是正道，
  见 aot-trimming）。
