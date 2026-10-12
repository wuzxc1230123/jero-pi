# 风格与格式（style-and-formatting）

> 来源：Microsoft Learn C# 编码约定 / Framework Design Guidelines（经 dotnet-skills 快照派生）；权威级：规范
> 锚定运行时：.NET 10 / C# 14 ｜ 核验日期：2026-10 ｜ 授权账本：`_sources.md`

## 优先级序

清晰 > 简洁 > 可维护 > 一致。冲突时前者胜：为省两行把三个概念
压进一个表达式的"聪明"代码，默认重写为显然版本。

## 格式归工具

- `.editorconfig` 是格式与命名分析的单一事实源；`dotnet format
  --verify-no-changes` 进 CI，格式争论零容忍。
- 团队风格差异用工具配置结束讨论，不用评审意见。

## 决策树：怎么写这个成员

```
成员是什么？
├─ 单行纯计算/转发 → 表达式体（public int Count => _items.Count;）
├─ 有逻辑分支/需要断点 → 块体
├─ 数据载体（无行为）→ record + init/required
└─ 有不变式的载体 → record + 私有构造 + 工厂（见 api-design）
```

## guard clause 与嵌套

- 参数校验/边界条件在方法顶部处理并 `return`/`throw`，主路径零缩进。
- 嵌套 2–3 层是抽方法信号；4 层以上必须重构。
- 早返回优于包裹整个方法体的 `if (ok) { …大块… }`。

## var 的取舍

| 右侧 | 选择 | 例 |
|---|---|---|
| 类型显然 | `var` | `var list = new List<Order>();` |
| 类型名携带信息 | 显式 | `IDictionary<string, int> counts = GetCounts();` |
| 数字字面量 | 显式 | `int timeout = 30;`（var 会推断成具体字面量类型） |
| 匿名/元组 | `var` 必选 | `var pair = (Name: "a", Count: 1);` |

## 表达式体成员谱系

- 属性 `=>`、方法 `=>`、构造器 `=>`（primary constructor 出现后少用）、
  get/set 单访问器 `=>`。
- 方法体超约 3 行回块体——表达式体不可逐行断点。

## 注释纪律

- 注释解释"为什么"（约束、取舍、踩坑），不复述"做什么"。
- XML doc 只写公共 API 面，第一人称省略（`/// Gets or sets …`
  谱系）；私有成员普通注释。
- TODO 带署名与上下文；注释掉的代码删除（git 记得一切）。

## 布局惯例

- 一个类型一个文件，文件名 = 类型名（含泛型 `Foo.cs` 不带 `` `1 ``）。
- 成员序：常量 → 字段 → 构造 → 属性 → 方法 → 事件；public 在前
  （或按区域分组，团队二选一钉死）。
- using 指令：`file` > `global`（集中一处）> 常规；`System` 前缀不再
  特殊（现代 using 排序按字母）。

## 反模式清单

- 单行多语句（`if (x) DoA(); else DoB();`）与省略大括号的单语句体。
- 方法超一屏（~40 行）不拆。
- 布尔参数裸传（见 api-design 的枚举/选项规则）。
