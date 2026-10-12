# 裁剪与 Native AOT（aot-trimming）

> 来源：dotnet-skills aot-trimming 快照（含 trimming-attributes-reference/playbook）/ dotnet-skills 仓库 dotnet-aot-compat（经 skills-main 快照派生）/ Microsoft Learn 裁剪与 AOT 文档；权威级：规范
> 锚定运行时：.NET 10 ｜ 核验日期：2026-10 ｜ 授权账本：`_sources.md`

## 模型

- **裁剪（PublishTrimmed）**：发布期删"静态不可达"的 IL——反射
  引用的成员对裁剪器不可见，删了运行时炸（`MissingMethodException`
  谱）。
- **Native AOT（PublishAot）**：编译期预编译成本机码——裁剪的全部
  约束 + 运行时代码生成禁用（`Reflection.Emit`/动态程序集/某些
  表达式树编译）。
- 心法：**AOT 的契约是"启动即全知"**——一切动态行为提前声明、生
  成或迁移。

## 开关阶梯（渐进暴露问题）

```xml
<PropertyGroup>
  <IsTrimmable>true</IsTrimmable>       <!-- 库：声明裁剪兼容 + 开分析 -->
  <PublishTrimmed>true</PublishTrimmed> <!-- 应用：先裁剪再谈 AOT -->
  <PublishAot>true</PublishAot>         <!-- 最终目标 -->
</PropertyGroup>
```

1. 库先 `IsTrimmable`（构建期出 IL2xxx 警告清单——工作清单成型）。
2. 应用 `PublishTrimmed` 发布测试（警告全清）。
3. `PublishAot` 出产物，**AOT 产物单独跑测试**（JIT 绿不等于 AOT
   绿——红线）。

## 警告家族

| 前缀 | 面 | 含义 |
|---|---|---|
| IL2xxx | 裁剪 | 反射可达性分析发现可疑模式 |
| IL3xxx | AOT | 运行时代码生成依赖 |

修复优先序：**重构消除反射 > 标注声明意图 > 基线文件（最后手段）**
。`UnconditionalSuppressMessage` 压制必须带理由与期限——批量平推
是掩盖。

## 标注谱系

```csharp
public static T Create<T>()
    where T : class
    => Activator.CreateInstance<T>()!;   // IL2057：无参构造不可见

// 解法一：约束表达契约
public static T Create<[DynamicallyAccessedMembers(
    DynamicallyAccessedMemberTypes.PublicParameterlessConstructor)] T>()
    where T : class
    => Activator.CreateInstance<T>()!;

// 解法二：公共面传染知情
[RequiresUnreferencedCode("Create uses reflection")]
public static object Create(Type t) => Activator.CreateInstance(t)!;
```

- `[DynamicallyAccessedMembers(…)]`：参数/字段/类型上声明"反射会
  碰这些成员"——裁剪器保留它们。
- `[RequiresUnreferencedCode("msg")]`：本方法内部裁剪不安全——
  警告传染到调用方（公共 API 的知情链）。
- `[RequiresDynamicCode("msg")]`：同族管 AOT（运行时代码生成）。
- `DynamicDependency`（字符串/成员声明旧形态）：新代码少用。

## 反射替代谱（主力解法）

| 反射面 | AOT 正道 |
|---|---|
| JSON 序列化 | 源生成 `JsonSerializerContext`（serialization-json） |
| 正则 | `[GeneratedRegex]` 源生成 |
| 日志 | `[LoggerMessage]` 源生成 |
| 配置绑定 | 源生成 binder（configuration-options） |
| 访问私有成员 | `UnsafeAccessor`（窄、显式） |
| 类型系统注册（DI 化工厂） | 源生成注册表 / 显式注册 |
| 动态代理 | 编译期生成（源生成器）或设计消除 |

`UnsafeAccessor` 样例（跨私有边界的显式契约）：

```csharp
[UnsafeAccessor(UnsafeAccessorKind.Field, Name = "_count")]
static extern ref int GetCount(List<int> list);
```

## 逃生舱（分级使用）

- `TrimmerRootDescriptor`/`TrimmerRootAssembly`：整程序集保活——
  粗粒度、体积回吐；只给"确实无法改造"的第三方依赖。
- feature switch：`[FeatureSwitchDefinition("Feature.X")]`——库内
  路径可关（默认值编译期固化进裁剪产物），`System.Text.Json` 用
  它关反射路径。
- `DynamicDependencyAttribute` 精确成员依赖。

## 兼容性检查单

- `System.Reflection.Emit`：AOT 全禁（IL3xxx 的根）。
- 表达式树**编译**（`Compile()`）：AOT 禁；解释执行可（性能差）——
    重构或 `Compile(preferInterpretation: true)` 语义确认。
- `Assembly.Load`/插件模型：改 AOT 侧固定引用或外进程插件。
- 反序列化多态：显式 `JsonDerivedType` 白名单（serialization-json）。
- 运行时绑定（`dynamic`）：禁。
- 事件/委托反射注册、`GetType().GetMethods()` 遍历：标注或重构。

## 产物与验证

- `dotnet publish -r win-x64 -c Release`（每 RID 各出——CI 矩阵）；
  首次发布慢（全程序集分析）。
- 启动收益量化：冷启动时间对比（benchmark 的启动面 + trace）；
  内存占用（工作集）对比。
- AOT 产物跑全量测试 + 冒烟（发布形态 ≠ 开发形态）。

## 红线

- 只测 JIT 宣布 AOT 兼容；`Reflection.Emit` 进 AOT 目标路径。
- 压制当修复（警告清单是债单，不是噪音）；根描述符保活整个依赖
  树"图省事"。
