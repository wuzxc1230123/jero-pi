# binlog 排障（binlog-analysis）

> 来源：dotnet-skills 仓库 dotnet-msbuild 插件 binlog-failure-analysis/binlog-generation/build-perf-diagnostics（经 skills-main 快照派生）/ MSBuild 官方结构化日志文档；权威级：建议
> 锚定运行时：.NET SDK 10 ｜ 核验日期：2026-10 ｜ 授权账本：`_sources.md`

## 为什么是 binlog

控制台输出是构建的摘要（截断、乱序、丢上下文）；`.binlog` 是构建
的**完整录像**——每个属性求值、每个目标/任务、每条消息带因果嵌
套。多项目级联失败（真凶在第一个红的 target，后面全是尸体）只有
binlog 看得清。

## 采集

```bash
dotnet build -bl:build.binlog          # 或 msbuild -bl
dotnet msbuild -bl -v:m                # 惯例：binlog 全息，控制台安静
```

- 复现不了的问题让 `DOTNET_CLI_TELEMETRY_OPTOUT` 无关，直接带
  `-bl` 重跑；失败即产物。
- binlog 含环境与文件路径（secret 一般不含——属性值会进日志，
  敏感值别放属性明文）。

## 读取

- **MSBuild Structured Log Viewer**（免费 GUI，`msbuildlog.com`）：
  打开 `.binlog`，树状看目标/任务嵌套，全文搜索。
- 命令面/CI：`dotnet binlogtool` 谱系或 viewer 的导出（转文本/
  比对）。MCP 路线（`Microsoft.AITools.BinlogMcp`）可接代理查询
  ——有则用，无则 GUI 即可。

## 排障剧本（构建失败）

1. **找第一个失败**：树里第一个红 target（后面的失败是级联尸体，
   不修它）。
2. **看任务输入**：展开任务的参数——`Exec` 的命令行、`Csc` 的
   `DefineConstants`/引用列表、`Copy` 的源与目标。
3. **问属性值**：搜索属性名看求值结果与来源文件/行号（`Directory.
   Build.props` 第几行赋的值——多处定义的胜负当场现形）。
4. **时间线归因**：并行构建（`-m`）的交错在时间线视图看——死锁/
   争文件在 `Copy`/`Touch` 的重叠窗现形。

## 常见形态速查

| 形态 | 现象 | 归因路径 |
|---|---|---|
| 级联失败 | 一堆项目全红 | 第一个红 target 前的 `Csc` 错误 |
| 属性漂移 | 行为与环境相关 | 搜属性名，多定义点 + 求值序 |
| 竞态 | 偶发失败 | 时间线重叠窗 + 争用文件 |
| 慢构建 | 分钟级 | 按目标耗时排序，`Inputs/Outputs` 缺失的自目标 |
| restore 假成功 | build 期 NUxxxx | restore/build 分层的 `--no-restore` 断链 |

## 慢构建专项（build-perf）

- viewer 的耗时排序：最贵目标清单（通常是自目标全跑或 `Csc` 未
  增量）。
- 逐项核对：自目标 `Inputs/Outputs` 缺失（msbuild-fundamentals 增
  量节）；`CleanFile`/通配输出每次失效增量；`Exec` 里内嵌 `dotnet
  build` 递归（二进程嵌套，改 MSBuild 任务直调）。
- `--graph-build` 与节点并行（`-m`）的收益在 binlog 时间线上可直
  接看到并行度缺口。

## 纪律

- CI 常态带 `-bl`（工件保留 N 天）——失败时不需要"再来一次抓
  现场"。
- binlog 是诊断产物，不进 git；`.gitignore` 已由模块 config 覆盖
  `bin/obj`（binlog 放产物目录）。
- 结论回写：binlog 发现的问题（属性漂移/增量断裂）修在项目系统
  层（`Directory.Build.props`），不在单个 csproj 打补丁。

## 红线

- 只看控制台猜级联失败的原因（真凶被淹没）。
- 在 binlog 里看到敏感值（连接串进了属性）——修配置面，不是修
  日志。
