# MSBuild 项目系统（msbuild-fundamentals）

> 来源：dotnet-skills 仓库 dotnet-msbuild 插件（property-patterns/directory-build-organization/incremental-build/item-management，经 skills-main 快照派生）/ MSBuild 官方文档；权威级：规范+建议
> 锚定运行时：.NET SDK 10 ｜ 核验日期：2026-10 ｜ 授权账本：`_sources.md`

## SDK 风格项目

```xml
<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <TargetFramework>net10.0</TargetFramework>
    <Nullable>enable</Nullable>
    <ImplicitUsings>enable</ImplicitUsings>
    <TreatWarningsAsErrors>true</TreatWarningsAsErrors>
  </PropertyGroup>
</Project>
```

- 默认通配包含 `.cs`（`EnableDefaultCompileItems`）；显式 `<Compile
  Include>` 列表是 legacy 痕迹。
- 多目标 `<TargetFrameworks>net8.0;net10.0</TargetFrameworks>` + 条
  件属性（`Condition="'$(TargetFramework)' == 'net8.0'"`）。

## 求值两阶段（理解一切 props 行为的前提）

1. **属性求值（Pass 1）**：`PropertyGroup` 自上而下、跨文件按导入
   序；`$(Prop)` 引用在求值期展开——后定义不可见。
2. **项与目标执行（Pass 2）**：`Target` 内任务按序执行；项的元数
   据变换（`%(Filename)` 批处理）在执行期。

推论：**`Directory.Build.props`（先导入）放默认值，`.targets`（后
导入）放钩子**；同一属性多处赋值按求值序"后者胜"——分散定义 =
隐式覆盖 = 排障地狱。

## Directory.Build.props/targets 分层

```
repo/
├─ Directory.Build.props        # 仓级默认：TFM/nullable/警告即错/版本
├─ Directory.Packages.props     # CPM（nuget-packaging）
└─ src/
   └─ Directory.Build.props     # 层覆盖：src 专属（测试项目再一层）
```

- MSBuild 沿目录树**向上取最近一份**（不是合并）——子目录一份即
  遮蔽父级；需要合并时父级写 `<Import>` 显式链回。
- 公共属性的单一事实源在仓级；csproj 只留项目专属差异。

## 增量构建

- 目标增量的机制：`Inputs`/`Outputs` 声明（时间戳比对）；自目标
  缺声明 = 每次全跑。
- 自定义目标样板：

```xml
<Target Name="GenerateNotice" Inputs="@(NoticeSrc)" Outputs="$(NoticeOut)">
  <WriteLinesToFile File="$(NoticeOut)" Lines="@(NoticeSrc->Metadata('License'))" />
</Target>
```

- 健康自检：二次 `dotnet build` 应近零成本（秒级）；缓慢的空构建
  = 增量链断裂（自目标缺 IO/任务不洁/`CleanFile` 误清）。
- `dotnet build --graph-build` 多项目图并行；`-m` 节点并行是默认
  （CPU 换吞吐）。

## 常用属性速查

| 属性 | 语义 |
|---|---|
| `TargetFramework(s)` | 目标框架（钉版） |
| `LangVersion` | C# 语言级（默认随 TFM，不手抬） |
| `Nullable` / `ImplicitUsings` | NRT 与隐式 using |
| `TreatWarningsAsErrors` + `WarningsAsErrors` | 警告治理 |
| `InvariantGlobalization` | 文化不变模式（容器提速） |
| `ServerGarbageCollection` | Server GC 开关（性能面） |
| `PublishTrimmed` / `PublishAot` | 裁剪/AOT（aot-trimming） |
| `RestorePackagesWithLockFile` | 锁文件还原（nuget-packaging） |
| `GenerateDocumentationFile` | XML doc 产物（公共库开） |

## restore 边界

- `dotnet restore` 独立可跑：CI 分层（restore 缓存层 + build 层）。
- `packages.lock.json` 提交 + CI `--locked-mode`（锁而不验是自欺）。
- `dotnet build` 内建 restore（`--no-restore` 显式关——CI 分层时
  后层必带）。

## 诊断

- `dotnet build -v n`（verbosity）看求值/目标流；`-bl` 出 binlog
  走图形化排查（binlog-analysis）。
- `dotnet msbuild -getProperty:Xxx`/`-getItem:Compile` 直接问求值
  结果（SDK 8+，比 echo PropertyGroup 快）。

## 红线

- 手改 `bin/`/`obj/` 内生成文件；`obj/*.cs` 由生成器产（source
  generator 产物在 IDE 可查看，不手编）。
- 同属性多层重复定义且值漂移（求值序决定胜负——读者不可见）。
- `DotnetCliToolReference` 时代工具（改 `dotnet tool` + 构建钩子）。
