---
name: dotnet-msbuild
description: MSBuild 项目系统：SDK 风格项目属性、Directory.Build.props 分层、增量构建、binlog 二进制日志排障、restore 与目标钩子。当调构建属性/排障构建失败或评审 csproj 时使用。触发词：MSBuild、csproj、构建、Directory.Build.props、binlog、restore、增量构建。
---

# MSBuild 项目系统

csproj 是代码：属性求值顺序、目标钩子与增量检查决定构建的正确与速度——"改到能跑"不算懂构建。

> **相关技能：** 构建产物排障深读 → 本技能两篇 references；测试门接线 → `dotnet-testing`；诊断工具 → `dotnet-diagnostics`。

## 何时使用

调整项目属性/中央属性分层、排查构建失败或缓慢、评审 `csproj` 变更时使用。

## 核心要点

- **SDK 风格是唯一形态**：`<Project Sdk="Microsoft.NET.Sdk">`；默认通配含 `.cs`，显式 `<Compile Include>` 列表是旧时代残留。
- **Directory.Build.props/targets 分层**：解决方案级公共属性（TFM/`TreatWarningsAsErrors`/nullable）进 props 一处钉；`.targets` 走构建钩子；子目录文件覆盖父级——层级即配置面。
- **属性求值序**：props（求值早期，全局默认）vs targets（执行期）；`Condition` 判断可用属性的阶段差是经典坑。
- **增量构建**：目标声明 `Inputs`/`Outputs` 才增量；自定义目标缺输入输出声明 = 每次全跑；`dotnet build` 二次跑应秒级（验证增量的土法）。
- **restore 边界**：`dotnet restore` 独立可跑（CI 分层缓存）；`PackageReference` 锁版本走 `packages.lock.json`（`RestorePackagesWithLockFile`）。
- **警告即待办**：新警告 `<WarningsAsErrors>` 收编；`NoWarn` 压制要有注释与期限。

## 红线

- 手改 `bin/`/`obj/` 内任何生成文件（`GlobalSuppress` 除外）。
- 解决方案里逐 csproj 复制粘贴公共属性（该上 `Directory.Build.props`）。
- 同属性在多层重复定义且值漂移（求值顺序决定胜负——隐式覆盖）。

## 深读指路（references/）

属性与目标谱系：`references/msbuild-fundamentals.md`；构建失败/级联的日志级排障：`references/binlog-analysis.md`。
