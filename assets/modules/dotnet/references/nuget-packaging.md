# 包管理（nuget-packaging）

> 来源：dotnet-skills 仓库 dotnet-nuget 插件 convert-to-cpm / dotnet-advanced nuget-trusted-publishing / dotnet-skills package-management·marketplace-publishing 快照 / NuGet 官方文档；权威级：规范+建议
> 锚定运行时：.NET SDK 10（NuGet 6.x+） ｜ 核验日期：2026-10 ｜ 授权账本：`_sources.md`

## Central Package Management

```xml
<!-- Directory.Packages.props（仓根） -->
<Project>
  <PropertyGroup>
    <ManagePackageVersionsCentrally>true</ManagePackageVersionsCentrally>
  </PropertyGroup>
  <ItemGroup>
    <PackageVersion Include="xunit" Version="2.9.3" />
    <PackageVersion Include="Polly" Version="8.5.2" />
  </ItemGroup>
</Project>
```

```xml
<!-- csproj 只声明依赖，不带版本 -->
<ItemGroup>
  <PackageReference Include="Polly" />
</ItemGroup>
```

- 版本一处可查可升；`dotnet list package --outdated` 全仓升级面
  一屏。
- 不回 CPM 的代价：同包多版本散落、升级靠全文搜索（漂移源）。

## 可复现还原

```xml
<PropertyGroup>
  <RestorePackagesWithLockFile>true</RestorePackagesWithLockFile>
</PropertyGroup>
```

- `packages.lock.json` 提交进仓（传递依赖全锁定）；CI `dotnet
  restore --locked-mode`（锁而不验是自欺——锁文件漂移即 FAIL）。
- 锁文件 PR diff 即依赖变更审计面。

## 源安全

```xml
<!-- nuget.config（仓根，提交） -->
<configuration>
  <packageSourceMapping>                    <!-- 防依赖混淆 -->
    <packageSource key="nuget.org">
      <package pattern="Microsoft.*" />
      <package pattern="System.*" />
      <package pattern="xunit*" />
    </packageSource>
    <packageSource key="private">
      <package pattern="Contoso.*" />
    </packageSource>
  </packageSourceMapping>
</configuration>
```

- `packageSourceMapping`：哪个包从哪个源解析显式映射——同名包
  注入攻击（依赖混淆）的结构防御。
- 凭据不进 nuget.config：环境变量/credential provider/managed
  identity；`nuget.config` 里的明文 PAT 是红线。
- 审计：`dotnet list package --vulnerable --include-transitive`
  进 CI 定期任务（NuGet Audit 构建期警告升级为错误的开关逐步收）。

## 引入纪律

- 新依赖看四件：维护活跃度（最近发版/issue 响应）、许可（传递
  面！）、传递闭包体积（`dotnet nuget why <pkg>` 查引入链）、替
  代面（BCL 已覆盖？`dotnet-upgrade` 的版本特性）。
- 升级策略：补丁/次要自动跟（CI 定期 PR）；主版本人工审读
  （breaking changes 逐条过）。

## 打包（类库发布）

```xml
<PropertyGroup>
  <PackageId>Contoso.Shipping.Domain</PackageId>
  <Version>1.2.0</Version>
  <RepositoryUrl>https://github.com/contoso/shipping</RepositoryUrl>
  <RepositoryType>git</RepositoryType>
  <PackageLicenseExpression>MIT</PackageLicenseExpression>
  <SymbolPackageFormat>snupkg</SymbolPackageFormat>
  <IncludeSymbols>true</IncludeSymbols>
  <GenerateDocumentationFile>true</GenerateDocumentationFile>
  <Deterministic>true</Deterministic>
  <ContinuousIntegrationBuild>true</ContinuousIntegrationBuild>  <!-- CI 中 -->
</PropertyGroup>
```

- 元数据齐：仓库/许可/作者/图标——SBOM 与来源审计的地基。
- `dotnet pack -c Release`：符号包 snupkg（源链接 `SourceLink`
  包进——`Deterministic` + `ContinuousIntegrationBuild` 可复现产
  物）。
- 版本化：SemVer 2.0——破坏性升主、新功能升次、修复升补丁；
  预发布 `1.2.0-beta.1`。

## 发布

- **Trusted Publishing（NuGet.org OIDC 谱系）**：GitHub Actions/
  Azure DevOps 直接 OIDC 断言发布，无 PAT 落地——首选。
- PAT 备选时最小作用域 + 轮换周期；secret 只在 CI 密钥存储。
- 发布即不可变：同版本重推被拒（`--skip-duplicate` 只对未存在版
  本）——发布前 `dotnet pack` 产物本地验装。

## 私有源与内部仓

- 私有 feed（Azure Artifacts/BaGetter 谱系）+ 上节 source
  mapping；内部包 `Contoso.*` 前缀统一（命名纪律见 naming-
  conventions 的命名空间节）。

## 红线

- 凭据/PAT 进 nuget.config 或 csproj 提交；锁文件提交但 CI 不开
  `--locked-mode`。
- 无 source mapping 的公私混合源（依赖混淆敞口）。
- 无 SBOM 元数据的发布包（下游审计断链）。
