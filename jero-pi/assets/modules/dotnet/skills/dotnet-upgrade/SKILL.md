---
name: dotnet-upgrade
description: 版本升级与迁移：目标框架阶梯（8→9→10→11）、upgrade assistant 与分析器驱动、弃用 API 治理、NRT 存量迁移剧本、运行时配置开关核对。当升 .NET 版本或迁移存量代码时使用。触发词：升级、迁移、TargetFramework、net9.0、net10.0、net11.0、弃用、obsolete、upgrade。
---

# 版本升级与迁移

升级是可编排的工程流程：升 TFM 只是第一步——弃用面、行为开关与分析器零警告才是完成态。

> **相关技能：** NRT 迁移深读 → `dotnet-nullable`；构建属性 → `dotnet-msbuild`；包版本治理 → `dotnet-nuget`。

## 何时使用

升级 .NET/C# 版本、迁移存量代码（含 NRT 启用）、处理弃用 API 时使用。

## 核心要点

- **阶梯逐版**：跨版本升级走单版步进（8→9→10），每步全量验证再进；LTS→LTS 是保守线（.NET 10 LTS 锚点），STS（11）只在需要前沿特性时。
- **TFM 同步面**：`net10.0` 改动连带——`global.json` SDK 版本、CI 镜像、所有 csproj 的 `TargetFramework`（CPM 下包版本兼容面）、`Directory.Build.props` 条件分支。
- **工具链**：`dotnet tool install -g upgrade-assistant` 驱动机械面（引用替换/TFM）；弃用 API 逐条人工裁决（`dotnet list package --outdated` 配合）；`Microsoft.DotNet.UpgradeAssistant.Extensions` 谱系按负载选（Windows Forms/WPF/ASP.NET）。
- **行为开关核对**：每版本有运行时行为开关（`System.Runtime.CompilerServices.RuntimeFeature` 谱系与 AppContext 开关）——升 TFM 默认开新行为，显式钉旧行为要列清单排期撤。
- **NRT 存量剧本**：`<Nullable>annotations` 先标注不报错 → 逐文件 `#nullable enable` 清警告 → 全局 enable；输出面先做（公共 API 标注即契约），内部流转后清。
- **弃用治理**：`SYSLIBxxxx`/`CS0618` 不压制——每条给迁移 PR；压制只允许带跟踪工单与期限（`#pragma warning disable` 集中管理）。
- **验证闭环**：每步 `dotnet build`（零新警告）+ 全量测试 + 基准对照（性能敏感项目，`dotnet-benchmark` 基线可比）。

## 红线

- 跨两版以上的大跳（中间版的行为差异无法审读）。
- 弃用警告批量压制当作"升级完成"。
- 升级 PR 混入功能变更（机械变更与语义变更分离）。

## 深读指路（references/）

逐版本升级剧本与迁移核对单：`references/upgrade-migrations.md`。
