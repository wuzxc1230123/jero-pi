# 验证协议（verification-gates）

> 来源：本仓原创（对齐 golang/godot 模块 verification-gates 协议，为 dotnet 域重铸）；权威级：项目纪律
> 锚定运行时：.NET 10 ｜ 核验日期：2026-10 ｜ 授权账本：`_sources.md`

## 原则

验证结论只认**退出码与落盘产物**："编译过了""我看着跑通了"不构
成证据。每道门留下可复查的命令 + 输出摘录 + 结论。

## 三道门（按序执行）

1. **还原与构建**：`dotnet build`（restore 内建）
   - 记录退出码与**警告计数**；`TreatWarningsAsErrors` 项目下警告
     即 FAIL。
   - 新警告必须处理（修/`NoWarn` 带注释与期限）——警告是待办不
     是背景噪音。
2. **静态门**：`dotnet format --verify-no-changes`
   - 项目已配置 formatter/analyzer 时运行；未配置不自行引入（工
     具面是项目决策，msbuild-fundamentals）。
   - 分析器诊断随构建输出记录（严重度映射 `warning`/`error`）。
3. **测试**：`dotnet test`
   - 记录退出码与通过/失败/跳过计数；涉及并发的变更确保全量跑
     （收窄的 `--filter` 只用于迭代中途）。
   - 覆盖面收窄必须在报告注明（"只跑了 Foo.Tests"），收窄跑过
     必须补全量才算完成。

## 证据形态（verification-report）

每道门：

```
命令：dotnet test
环境：dotnet 10.x.y（global.json 钉 10.x）
退出码：0
关键输出：Passed! - Failed: 0, Passed: 187, Skipped: 2, Duration: 34s
结论：PASS（Skipped 2 条带工单号——清单见下）
```

结论三元：`PASS | FAIL | NOT VERIFIED`——工具链不可用（PATH 无
`dotnet`、版本低于 `global.json` 声明）时如实 `NOT VERIFIED` 附原
因，**绝不伪装通过**。

## 上下文纪律

- `global.json` 钉 SDK 版本：报告附 `dotnet --version` 输出；版本
  不匹配是 NOT VERIFIED 的合法原因（不是绕过 `rollForward` 的理由）。
- 目标框架多档（`net8.0;net10.0`）时逐档跑或注明未覆盖档。
- Release 依赖的验证（基准/性能）必须 `-c Release` 单独跑——Debug
  数字无效（benchmark-measurement）。

## 与模块机制的接线

- 模块 `config.testCommand` 钉住 `dotnet test`——SDD Strict TDD
  的取值链第一级（覆盖层 → config.yaml → 探测）；改测试命令改
  清单，不改脚本硬编码。
- `dotnet-tester` 角色是本协议的执行者（有界写者：只动测试与验证
  产物）；评审者消费报告但不重跑。
- `bin/`/`obj/` 永远是再生成物：验证前后不必清理（增量构建健康
  本身是门 1 的副产品），疑似脏产物污染时 `dotnet clean` 后复跑
  并记录。

## 红线

- 无退出码引用的"通过"结论；把警告当正常输出忽略。
- 用 `--filter` 收窄后宣布全绿。
- 在验证报告里替未跑的档/平台代言（"Windows 上过了，Linux 应该
  也行"不是结论）。
