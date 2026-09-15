# G4 Windows 环境基线（非回归清单）

> 2026-09-15，jero-pi G4 测试收尾时建立。判定方法：同一测试文件在参考库 gentle-pi-main（同机、同 Node）跑出**相同失败集** → Windows 环境基线，不算 jero-pi 回归。上游对照运行只写 OS tmpdir，参考库只读。
> 复跑方法：`node /c/Users/Administrator/AppData/Local/Temp/claude/run-jero-tests.mjs`（按文件、180s/文件预算，HANG 即超时标记）。

## 挂起（4，HANG）

| 文件 | 备注 |
|---|---|
| review-candidate-view.test.ts | 上游同挂（历史基线） |
| review-controller-native-routing.test.ts | 上游同挂（历史基线） |
| review-controller-workspace-root.test.ts | 上游同挂（历史基线） |
| review-recovered-lineage-routing.test.ts | 本机新增发现，同族 |

全量 `node --test tests/*.test.ts` 会因此永不结束——只能按文件带预算跑。

## 失败（按文件，上挂数=jero 挂数且名单一致）

| 文件 | 上游失败数 | 根因族 |
|---|---|---|
| gentle-agents.test.ts | 7 | spawn/git 子进程（attribution、diff relay、spawn adapter、agentRuntimePaths 显式 home 路径） |
| gentle-shell.test.ts | 1 | 断言正则期望 `/` 分隔路径，Windows 实际 `\` |
| opaque-pi-reviewer-adapter.test.ts | 4 | spawn 无扩展名可执行文件（pi/env-probe）ENOENT，Windows 不解析 |
| openspec-guardrails.test.ts | 1 | 同 gentle-shell：正则 vs 反斜杠 |
| orchestrator-budget.test.ts | 1 | 子进程 ESM 导入 `d:` 协议路径（Windows 绝对路径非 file:// URL） |
| review-agent-end-preflight.test.ts | 11 | spawn/IPC 族 |
| review-gate.test.ts | 4 | git push 探针 spawn 族 |
| review-host-relay.test.ts | 25 | env-probe spawn ENOENT（与上游 13/25 完全同数） |
| review-session-standing-permission-ipc.test.ts | 2 | fd3/IPC 族 |
| review-snapshot.test.ts | 1 | 嵌套 cwd 快照（Windows git 行为） |
| review-transaction.test.ts | 1 | annotated tag push 探针 |
| review-risk-assessment.test.ts | 1 | 上游同败（对照：48 pass / 1 fail） |
| sdd-managed-runtime-settlement.test.ts | 15 | "native SDD planning home escaped its workspace" 等，上游同败 |
| skill-registry.test.ts | 1 | `fileURLToPath('file:///home/...')` 无盘符 URL 在 Windows 抛 "path must be absolute" |

### 表现不稳定（慢机/PowerShell 冷启动依赖）——review-session-standing-permission-controller.test.ts

同文件同代码两侧皆有：机器热时上游 18/0 全过；冷机单跑上游 2 分钟跑不完（4 pass/1 fail/未完成）。根因：`lib/review-candidate-view-owner.ts` 的 Windows SID/DACL 校验每次 spawn PowerShell（无记忆化），本机单次 1–3s，单次超 5s 时 execFileSync timeout 抛 WindowsOwnerValidationError 表现为断言失败；整体则表现为文件级"挂起"。CPU profile 证据：44s 中 ~40s 在 windowsOwnerSid/windowsLocalAdministratorSid 的 spawnSync。判定：环境基线（上游存在同样问题），非 jero-pi 移植缺陷。

## 已修复的移植缺陷（G4 内修复，留档）

| 文件 | 缺陷 | 修复 |
|---|---|---|
| 多文件 | 缺 tests/fixtures/devbinary、openspec/、.github/ISSUE_TEMPLATE、dependabot.yml | 从上游逐字节移植（diff -rq 0 行差异） |
| install-tui-mode-setting.test.ts | 测试仍造 gentle-pi 路径；另发现 scripts/install-tui-mode-setting.mjs G0 移植时丢失"调用方 packageRoot 必须等于 owned 位置"绑定（安全隐患） | 测试全部改 jero-pi 路径；postinstall 生命周期块（依赖已删 installer）整块删除；脚本恢复上游 ownership 判定 |
| gentle-ai.test.ts | 3 个测试断言已删除域（二进制恢复指引、ask-user-choice blocked 通道） | 改为零二进制姿态断言（unavailable fail-closed、无 installer 引用）；rpiv 单监听断言；choice-blocker 测试删除（D6 删除域） |
| verify-package-files.test.ts | 自身笔误：写 docs/ 前未建父目录 | mkdir recursive |
