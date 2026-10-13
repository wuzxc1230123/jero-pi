# 命名（naming-conventions）

> 来源：Framework Design Guidelines / Microsoft Learn 命名约定（经 dotnet-skills 快照派生）；权威级：规范
> 锚定运行时：.NET 10 / C# 14 ｜ 核验日期：2026-10 ｜ 授权账本：`_sources.md`

## 决策树

```
命名什么？
├─ 类/结构/记录/枚举/事件/属性/方法/常量 → PascalCase（OrderProcessor）
├─ 接口 → I + PascalCase（IDisposable）
├─ 参数/局部变量 → camelCase（orderCount）
├─ 私有字段 → _camelCase（_orderCount）；公共字段（避免）PascalCase
├─ 异步方法（返回 Task/ValueTask）→ 动词 + Async 后缀（SendAsync）
├─ 布尔属性/方法 → Is/Has/Can/Allows 开头（IsActive）
├─ 泛型参数 → 单字母 T 或 T + 描述（TKey/TEntity）
├─ 特性（Attribute）→ 名词 + Attribute 后缀
└─ 测试 → 方法_场景_预期（Withdraw_InsufficientFunds_Throws）
```

## 大小写细则

- 缩略词两字母全大写（`IO`、`DB`、`UI`），两字母以上按单词
  （`Xml`、`Html`、`Id`、`Api`）——BCL 自己的 `IDisposable`/
  `DBNull` 是历史化石，新代码不效仿。
- 命名空间 PascalCase 按公司.产品.层（`Contoso.Shipping.Domain`）；
  程序集名与根命名空间一致。
- 资源键、配置键 camelCase；HTTP/JSON 契约面 camelCase（序列化策略
  管，不改 C# 名）。

## 语义命名

- 方法动词开头：Get/Read（查询）、Create/Add（构造）、Try + 动词
  （可失败）、Update/Apply（变更）、Calculate/Compute（推导）。
- 布尔肯定式：`IsValid` 不 `IsNotInvalid`；避免否定的组合爆炸
  （`DisableX` 与 `EnableX` 并存是状态机泄漏）。
- 名字长度与作用域成正比：循环计数 `i`；方法内 `count`；类型/公共
  成员自带上下文（`Order.TotalAmount` 而非 `Order.OrderTotalAmount`）。
- 集合类型名复数（`Orders`）；`FooList`/`FooCollection` 后缀只在该
  语义重要时（暴露实现细节的后缀不写）。

## 接口与抽象

- 接口名词/形容词（`IRepository<T>`、`IComparable`）；可测试替身
  命名 `FakeX`/`StubX`/`SpyX`，测试里不叫 `IMock`。
- 抽象类 vs 接口：is-a 可复用骨架用抽象类，can-do 契约用接口；
  默认接口成员只用于版本演进（不当作 trait）。

## 后缀的气味

- `Manager`/`Helper`/`Utils`/`Common`/`Core`：职责不清的万金油——
  重命名前先问该不该拆类型/项目。
- `Info`/`Data`/`Record`：不增语义的后缀——换成领域名词。
- `Ex`/`2`/`New`：版本化后缀——用命名空间或显式新名（`ProcessX`
  与 `ProcessX2` 并存是兼容债，给日落时间）。

## 事件与测试

- 事件名动词或动词短语（`OrderPlaced` 被动/`Changed`）；事件处理器
  `On + 事件名`；事件参数类 `XxxEventArgs`。
- 测试方法名是规格书：行为 + 条件 + 预期（`Withdraw_WhenInsufficientFunds_Throws`）；
  本地化团队用中文规格名亦可，但一套方案一种语言。

## 红线

- 匈牙利前缀（`strName`）与下划线分隔（`order_total`——除非与
  数据库/JSON 契约映射，且经序列化特性转换）。
- C# 关键字 homoglyph（`@class`）与重音字符进公共 API。
- 同一概念多种拼法并存（`Canceled`/`Cancelled`）——框架用
  `Canceled`，全仓一致。
