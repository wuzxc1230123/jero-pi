---
name: dotnet-project
description: 解决方案与项目结构：分层与依赖方向、Directory.Build.props 放置、测试项目对应、解决方案文件夹语义、internal 划界与 InternalsVisibleTo。当创建/重组解决方案或评审项目布局时使用。触发词：解决方案、sln、项目结构、分层、Directory.Build.props、InternalsVisibleTo、布局。
---

# 解决方案与项目结构

结构是依赖方向的物化：读者从项目引用图就能读出架构——若要读代码才知道谁依赖谁，结构已经输了。

> **相关技能：** 构建属性面 → `dotnet-msbuild`；升级迁移 → `dotnet-upgrade`；包治理 → `dotnet-nuget`。

## 何时使用

新建/重组解决方案与项目、决定分层与引用方向、评审项目布局与命名时使用。

## 核心要点

- **分层以依赖方向为先**：`Domain`（实体/域服务，零外部依赖）← `Application`（用例编排）← `Infrastructure`（EF/IO 实现）← `Api/Host`（组装根）；依赖箭头指向稳定端，域层不引用基础设施。
- **组合根唯一**：DI 装配只发生在 Host/Api（`dotnet-di` 的装配扩展方法由它消费）；库项目不 `AddDbContext` 之类自装。
- **公共属性归位**：`Directory.Build.props`（版本/TFM/分析器）钉在仓库根或解决方案根；`Directory.Packages.props` 同级（CPM）；测试公共属性进各自层级。
- **测试项目一一对应**：`Foo` ↔ `Foo.Tests`（单元）+ 按需 `Foo.IntegrationTests`（容器依赖）；解决方案文件夹（sln 的虚拟分组）映射分层，不当杂物抽屉。
- **internal 划界**：默认 `internal`，公开面是决策不是习惯；`InternalsVisibleTo` 只开给测试（`ItemGroup` 里的 `AssemblyAttribute` 生成），不当跨项目后门。
- **命名即职责**：项目名 `Company.Product.Layer`；禁 `Core`/`Common`/`Shared`/`Utils` 万能桶——放不进某层的代码先问归属，再问建层。
- **SingleProject 起步**：新方案一个项目起步，边界明确再拆——结构服务演化，不为简历服务。

## 红线

- 循环项目引用（分支出新项目承载共享面）。
- Host 以外的项目直读配置/环境变量（配置消费在组合根与边界适配器）。
- 十几个项目的"微服务"新仓库（从单体起步，模块化单体先行）。

## 深读指路（references/）

分层谱系与布局决策树：`references/project-structure.md`。
