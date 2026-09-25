# G4 Windows 环境基线（非回归清单）

> 2026-09-15，jero-pi G4 测试收尾时建立。判定方法：同一测试文件在参考库 gentle-pi-main（同机、同 Node）跑出**相同失败集** → Windows 环境基线，不算 jero-pi 回归。上游对照运行只写 OS tmpdir，参考库只读。
> 复跑方法：`node /c/Users/Administrator/AppData/Local/Temp/claude/run-jero-tests.mjs`（按文件、180s/文件预算，HANG 即超时标记）。
>
> **2026-09-21 大清账**：下表多数族已修复（见底部"2026-09-21 清账批次"）。
> 现存挂起仅剩 PowerShell ACL 三件套。逐文件快照见该节。
>
> **2026-09-25 复测清账**：三件套全部**完整跑完、零失败**，"全量永不结束"已不再成立——
> 单文件实测：review-candidate-view 179s（50 pass/0 fail）、review-controller-native-routing 19s
> （11 pass/0 fail）、review-controller-workspace-root 54s（11 pass/0 fail）；全量 `pnpm test`
> （--test-concurrency=12）同机两次完整结束（2292 项 / 0 fail）。仅存风险：candidate-view 的
> 179s 贴着 180s/文件预算线，冷机仍有翻越可能；根治路径不变（enforce 的精确三 ACE 重建迁
> icacls 或并行化，owner 读取本就需 PowerShell，无法全迁）。CI 侧已由 Windows job 的名称模
> 式筛选隔离，不受影响。

## 挂起（2026-09-25 复测：全部可完成；历史记载见下）

| 文件 | 备注 |
|---|---|
| review-candidate-view.test.ts | PowerShell ACL 冷启动慢（每边界 1.5-2.5s），根治=icacls/并行化专项 |
| review-controller-native-routing.test.ts | 同族（导入 CandidateViewRegistry，首测试即挂） |
| review-controller-workspace-root.test.ts | 同族 |
| ~~review-recovered-lineage-routing.test.ts~~ | 2026-09-21 转绿（2/2 干净退出） |

~~全量 `node --test tests/*.test.ts` 仍因上述三件套不结束~~（2026-09-25 复测已可完整结束，见顶部清账附录；candidate-view 单文件 179s 仍建议带预算跑）。

## 失败（2026-09-21 清账后全部归零；历史记录见 git）

| 文件 | 原失败数 | 修复（2026-09-21） |
|---|---|---|
| gentle-agents→jero-agents.test.ts | 7 | resolveWorktree 用 sep；spawn adapter win32 真实 git init 探针；agentRuntimePaths join；locator fixture 补 P4e-1 迁移 |
| review-host-relay.test.ts | 22 | shebang 路由（生产 lib/review-host-relay.ts）；cleanup-fail 分离 CWD 占位进程 + kill 旗标；TEMP/TMP；abort 延迟；EPERM 退避 |
| review-agent-end-preflight.test.ts | 6+挂起 | 六测试补 withSessionStartEnv；STATUS 基线移点；**binds-consumption await 永悬修复后整文件 41/41 干净退出**（原"挂起名单"真凶） |
| review-session-standing-permission-ipc.test.ts | 2 | **生产修复**：fd3 管道 prime 帧 + 500ms 心跳（Windows 上管道在父进程首次写入前双向死锁、静默后休眠） |
| sdd-managed-runtime-settlement.test.ts | 15 | fixture join；R1 断言 JSON 转义形式 |
| review-risk-assessment / jero-shell / openspec-guardrails / orchestrator-budget / skill-registry / review-snapshot / review-transaction / review-gate / opaque-pi-reviewer-adapter | — | 2026-09-18 批次已修，维持绿 |

## 表现不稳定（慢机/PowerShell 冷启动依赖）——review-session-standing-permission-controller.test.ts

同文件同代码两侧皆有：机器热时上游 18/0 全过；冷机单跑上游 2 分钟跑不完（4 pass/1 fail/未完成）。根因：`lib/review-candidate-view-owner.ts` 的 Windows SID/DACL 校验每次 spawn PowerShell（无记忆化），本机单次 1–3s，单次超 5s 时 execFileSync timeout 抛 WindowsOwnerValidationError 表现为断言失败；整体则表现为文件级"挂起"。CPU profile 证据：44s 中 ~40s 在 windowsOwnerSid/windowsLocalAdministratorSid 的 spawnSync。判定：环境基线（上游存在同样问题），非 jero-pi 移植缺陷。

## 2026-09-21 新增 Windows 机制认知（生产级，非测试技巧）

1. **fd3 管道死锁**：spawn stdio[3] 管道在父进程首次写入前不投递任何方向数据；静默 ~秒级后再次休眠（竞态）。修复=broker 构造时空行 prime + 500ms unref 心跳（lib/review-session-standing-permission-ipc.ts）。
2. **中央运行器的 shebang 路由**：collectGentleAiProcess 与 createNodeExecFileAdapter 已按 opaque-pi-reviewer-adapter 同规则路由（检测 `#!` 头→execPath 运行）。新增 spawn/execFile 场景沿用。
3. **目录清理占位**：Windows 忽略目录只读位；打开句柄不阻 POSIX 语义 rm；可靠占位=分离进程 chdir 进目标目录（EPERM），配 kill 旗标协作退出。打开句柄挡 rm 的旧模式在新 Node 已失效。
4. **TMPDIR**：Windows os.tmpdir() 读 TEMP/TMP，三个都设才跨平台生效。
5. **abort 杀进程的句柄滞后**：close 事件后 cwd 句柄释放可滞后，teardown rmSync 需 EPERM 退避重试。

### 表现不稳定（慢机/PowerShell 冷启动依赖）——review-session-standing-permission-controller.test.ts

同文件同代码两侧皆有：机器热时上游 18/0 全过；冷机单跑上游 2 分钟跑不完（4 pass/1 fail/未完成）。根因：`lib/review-candidate-view-owner.ts` 的 Windows SID/DACL 校验每次 spawn PowerShell（无记忆化），本机单次 1–3s，单次超 5s 时 execFileSync timeout 抛 WindowsOwnerValidationError 表现为断言失败；整体则表现为文件级"挂起"。CPU profile 证据：44s 中 ~40s 在 windowsOwnerSid/windowsLocalAdministratorSid 的 spawnSync。判定：环境基线（上游存在同样问题），非 jero-pi 移植缺陷。

## 已修复的移植缺陷（G4 内修复，留档）

| 文件 | 缺陷 | 修复 |
|---|---|---|
| 多文件 | 缺 tests/fixtures/devbinary、openspec/、.github/ISSUE_TEMPLATE、dependabot.yml | 从上游逐字节移植（diff -rq 0 行差异） |
| install-tui-mode-setting.test.ts | 测试仍造 gentle-pi 路径；另发现 scripts/install-tui-mode-setting.mjs G0 移植时丢失"调用方 packageRoot 必须等于 owned 位置"绑定（安全隐患） | 测试全部改 jero-pi 路径；postinstall 生命周期块（依赖已删 installer）整块删除；脚本恢复上游 ownership 判定 |
| gentle-ai.test.ts | 3 个测试断言已删除域（二进制恢复指引、ask-user-choice blocked 通道） | 改为零二进制姿态断言（unavailable fail-closed、无 installer 引用）；rpiv 单监听断言；choice-blocker 测试删除（D6 删除域） |
| verify-package-files.test.ts | 自身笔误：写 docs/ 前未建父目录 | mkdir recursive |

## Windows 兼容修复批次（2026-09-18）

对文档基线失败族的逐项修复（全部为移植缺陷或 Windows 特有路径/环境差异，非上游同败）：

| 文件 | 修复 | 结果 |
|---|---|---|
| jero-shell | git porcelain 正斜杠 vs 原生路径 | 28/0 |
| openspec-guardrails | 正则字符类补 \ 分隔符 | 4/0 |
| orchestrator-budget | ESM 子进程 pathToFileURL；pre-diet 夹具品牌同步 | 38/0 |
| skill-registry | 无法转换的外来 file URL 仍判非本地副本 | 17/0 |
| review-snapshot | --show-toplevel 前斜杠→realpathSync.native 归一 | 9/0 |
| review-transaction / review-gate | shebang 假 git 探针 POSIX 限定（Windows CreateProcess 不解析无扩展脚本） | 11/0、24/0 |
| opaque-pi-reviewer-adapter | shebang 启动器经 execPath 路由；break-cleanup 用分离锁持进程（Windows 忽略目录只读位） | 7/0 |
| review-agent-end-preflight | 夹具 cwd→git toplevel；own-write 绝对路径 | 21/5（剩 5 为逻辑级基线） |
| review-risk-assessment | assess 夹具 cwd→git toplevel（键一致） | 44/0 |
| review-candidate-view | owner-SID 记忆化+批量单次 PowerShell+创建者种子；DACL enforce 保留精确 SDDL 写 | 超时→122/19（仍超 170s 预算：PowerShell SetAccessControl 每边界 1.5-2.5s 冷启动） |

候选视图根治需把全部 PowerShell ACL 操作换成 icacls（含 enforce 的精确三 ACE 重建——icacls /remove 逐 trustee 可行）或并行化——留作专项。
