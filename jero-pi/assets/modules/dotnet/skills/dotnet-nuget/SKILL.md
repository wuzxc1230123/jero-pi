---
name: dotnet-nuget
description: 包管理与发布：Central Package Management（Directory.Packages.props）、锁文件与还原可复现、私有源与trusted publishing、打包元数据与符号。当管理依赖版本或发布包时使用。触发词：NuGet、包管理、PackageReference、CPM、Directory.Packages.props、nuget.config、发布包。
---

# 包管理（NuGet）

依赖面是攻击面也是维护面：版本一处钉、还原可复现、发布走最小权限——"能编译"只是包管理的下界。

> **相关技能：** 解决方案结构（props 放置） → `dotnet-project`；升级迁移 → `dotnet-upgrade`；构建还原层 → `dotnet-msbuild`。

## 何时使用

治理包版本（CPM 引入/维护）、配置源与凭据、打包发布类库时使用。

## 核心要点

- **CPM 是默认形态**：根 `Directory.Packages.props` 声明 `<PackageVersion Include="x" Version="y" />`；csproj 只写 `<PackageReference Include="x" />` 不带版本——版本一处可查可升。
- **可复现还原**：`RestorePackagesWithLockFile` + `packages.lock.json` 提交——CI 按 lock 还原（`--locked-mode`），构建不受传递依赖漂移影响。
- **源与凭据**：`nuget.config` 分层（提交的仓库级声明源；凭据走环境/凭据管理器不进文件）；私有源走 PAT/credential provider；`packageSourceMapping` 防依赖混淆（哪个包来自哪个源显式映射）。
- **发布面**：trusted publishing（NuGet.org 的 OIDC 无 PAT 流）或 API key 最小作用域；`dotnet pack -c Release` + 符号包（`.snupkg`）；`RepositoryUrl`/`License`/`PackageId` 元数据齐——SBOM/来源审计的地基。
- **审计**：`dotnet list package --vulnerable --outdated` 进 CI 定期任务；弃用包治理（`Microsoft.AspNetCore.*` 谱系更替）跟 `dotnet-upgrade`。
- **传递面审读**：新增依赖看传递闭包体积与许可；`dotnet nuget why <pkg>` 查引入链。

## 红线

- 同一包多版本散落 csproj（无 CPM 的版本漂移）。
- 凭据/PAT 进 nuget.config 或 csproj 提交。
- lock 文件提交但 CI 不开 `--locked-mode`（锁而不验）。

## 深读指路（references/）

CPM/源安全/发布工作流：`references/nuget-packaging.md`。
