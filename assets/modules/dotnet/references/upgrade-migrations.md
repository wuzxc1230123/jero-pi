# 升级与迁移（upgrade-migrations）

> 来源：dotnet-skills 仓库 dotnet-upgrade 插件（migrate-dotnet8-to-9/9-to-10/10-to-11/migrate-nullable-references/thread-abort-migration/dotnet-aot-compat，经 skills-main 快照派生）/ .NET 官方升级指南；权威级：建议
> 锚定运行时：.NET 10 LTS（.NET 11 STS 预览中） ｜ 核验日期：2026-10 ｜ 授权账本：`_sources.md`

## 版本谱系与选线

| 版本 | 类型 | 支持窗 |
|---|---|---|
| .NET 8 | LTS | 至 2026-11 |
| .NET 9 | STS | 至 2026-05（已尽） |
| .NET 10 | LTS | 至 2028-11（当前锚点） |
| .NET 11 | STS | 2026-11 发布（预览中） |

- 保守线：LTS→LTS（8→10）；STS 只在需要前沿特性且团队跟得起年
  升节奏时上。
- TFM 阶梯 `net8.0 → net9.0 → net10.0`：**单版步进**，每步全量
  验证再进（跨两版大跳 = 中间版行为差异不可审读）。

## 升级剧本（单步）

1. **同步面清单**：所有 csproj 的 `TargetFramework`、`global.json`
   SDK 版本（`rollForward: LatestPatch` 起步）、CI 镜像/动作版本、
   CPM 包版本（依赖包对新 TFM 的兼容矩阵）、`Directory.Build.
   props` 条件分支。
2. **机械面**：`upgrade-assistant`（`dotnet tool install -g
   upgrade-assistant`）驱动 TFM/引用替换；Windows Forms/WPF/ASP.NET
   有对应扩展包。
3. **弃用治理**：构建输出逐条 `SYSLIBxxxx`/`CS0618` 裁决——每条
   迁移到新 API 或带工单的临时压制（`#pragma` 集中管理 + 期限）；
   批量压制当"完成"是自欺。
4. **行为开关核对**：新版默认行为变更（GC 策略/默认编码/安全协
   议……）列清单：接受新默认或显式钉旧值（钉旧值要有排期撤——
   `AppContext` 开关债单化）。
5. **验证闭环**：`dotnet build`（零新警告）+ 全量测试（`dotnet
   test` 多档 TFM 时逐档）+ 基准对照（性能敏感项目，benchmark-
   measurement 同机基线）+ 冒烟（发布形态）。
6. **机械变更与功能变更分 PR**：升级 PR 只含升级产物——diff 即
   审计面。

## NRT 存量迁移（专项）

详谱见 nullable-reference-types 迁移剧本节；要点：

1. `annotations` 模式先行（公共 API 标注 = 提前发布契约）。
2. 逐文件 enable 清零；全局收口。
3. `!` 宽容运算符逐条置换为流转正确的构造。

## 已知迁移族（速查）

| 族 | 形态 | 解法 |
|---|---|---|
| `Thread.Abort`（.NET 9 弃） | 不支持的平台直接抛 | 协作式取消（`CancellationToken`，async-patterns） |
| `BinaryFormatter` | .NET 9 默认禁用 | System.Text.Json/MessagePack 重写（serialization-json） |
| `AppDomain` 卸载语义 | 行为差异 | 进程隔离/AssemblyLoadLibrary（可卸载集合） |
| EF Core 9→10 | 查询翻译行为微调 | 迁移脚本重生成 + 查询回归（efcore-patterns） |
| AOT 兼容 | 新目标 | IsTrimmable→PublishTrimmed→PublishAot 阶梯（aot-trimming） |

## 升级窗口策略

- 跑在支持线内：EOL 前 6 个月排升级（`.NET 8` → 10 的窗口就是
  2026 上半年——**已到期尾窗，立即排**）。
- 预览版只做兼容性试验（分支 CI 矩阵加 `net11.0` 预览档），不
  进主干。
- STS→LTS 跨两版（9→11 不存在，9 已尽）——回落到 10。

## 红线

- 跨版本大跳；升级 PR 混功能变更。
- 弃用警告批量压制/`NoWarn` 全局加项当升级完成。
- 锁文件不更新（还原面漂移）与 `global.json` 不动（SDK 隐式前滚
  的新行为无审计）。
