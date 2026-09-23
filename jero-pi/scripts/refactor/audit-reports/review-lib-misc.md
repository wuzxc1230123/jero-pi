# lib 其余模块审核报告

> 子代理两次因网关 524 超时未交付，本报告由主会话基于声明/结构分析 + 关键段精读产出。覆盖范围：sdd-*.ts、memory.ts、model-routing-authority.ts、session-*.ts、openspec-*.ts、shell-*.ts、native-*.ts、jero-authority-cli.ts、opaque-pi-reviewer-adapter.ts、terminal-theme.ts、agent-home.ts、agent-profiles.ts、runtime-metrics*.ts 等（这一域**全部文件均未超 1000 行**，最大 sdd-status.ts 797、sdd-preflight.ts 1132）。

## 循环依赖 TDZ 高危点 —— 结论：**无真实高危点**

程序化核验（脚本扫描全部 15 个 `lib/jero-ai-*.ts` 模块）：

**方法**：对每个模块的 (a) 顶层 `const X = <init>` 初始化表达式、(b) `class X extends Y` 的父类表达式，检查其引用的标识符是否来自"能反向到达本模块"的环上模块。

**结果：0 命中。** 全部跨环引用都是**函数声明**（hoisted，模块求值顺序无关）或**类型**（strip-types 时擦除）。具体：

| 环路径 | 跨环引用形式 | 安全性 |
|---|---|---|
| `jero-ai-model-config ↔ jero-ai-model-routing-apply` | apply 侧 import `agentModelProfileConfigPath`/`listDiscoverableAgents` 等**函数**；config 侧 import `isProviderReviewRole` **函数** | 安全（函数提升） |
| `jero-ai-persona-config → jero-ai-prompts → jero-ai-package-assets → jero-ai-model-config → jero-ai-model-routing-apply → jero-ai-persona-config` | 链上全部是函数引用；`PACKAGE_ROOT`（package-assets:14）**只被本模块内 ASSETS_DIR 与下游 prompts:21 使用，不被任何上游环成员引用** | 安全 |
| `jero-ai-background-subagents → jero-ai-guardrails → jero-ai-persona-config → jero-ai-prompts → jero-ai-rdd-status → jero-ai-background-subagents` | 同上，全部函数 | 安全 |

**但存在两个结构性隐患（非当前 bug，是重构后的埋雷）**：
1. **`jero-ai-prompts.ts:21`** `const PROVIDER_CONTRACT_MIRROR_ROOT = join(PACKAGE_ROOT, "contracts", ...)` 是**顶层 const 值**，引用环上模块 `jero-ai-package-assets` 的顶层 const `PACKAGE_ROOT`。当前安全**仅因为** package-assets 不（间接）依赖 prompts 的求值。若未来有人给 `jero-ai-package-assets.ts` 加一条 import prompts 的语句，这里立刻变成 TDZ 崩溃。**建议**：把 `PACKAGE_ROOT` 下沉到无依赖的 `lib/package-paths.ts`（同时消除后文所述的三处重复），彻底断开环。
2. **环的存在本身是拆分计划的副作用**：15 个新模块是机械平移的产物，按"域"切分时不可避免产生互引。`jero-ai-package-assets` 与 `jero-ai-model-config` 互相 import（前者 6 处、后者 11 处 import），`persona-config` 被 `guardrails`/`prompts`/`writer-scope`/`sdd-startup` 四路依赖。建议在 stage1 剥离后做一次**依赖分层**：`package-paths`（零依赖）→ `persona-config`（配置路径）→ `prompts`/`guardrails`（消费配置）→ 其余。

## sdd-preflight.ts 拆分建议（1132 行 → 3 文件）

75 个顶层声明，三段边界清晰：

| 新文件 | 行区间 | 内容 | 预计行数 |
|---|---|---|---|
| `sdd-preflight-managed-assets.ts` | 4-72, 147-178, 249-540, 633-890 | 托管资产全生命周期：PACKAGE_ROOT/ASSETS_DIR/MANAGED_ASSETS_* 常量、`ASSET_OWNER_BY_KEY`+`getPackageAssetOwner`、`ManagedAssetsManifest`/`LegacyManagedAssetsManifest`、锁（`acquireManagedAssetsLock`/`releaseManagedAssetsLock`/`withManagedAssetsLock`/`waitForManagedAssetsLock`）、清单读写、`copyDirectoryFiles`、`installSddAssets`/`installPackageAssets`、`RETIRED_MANAGED_ASSETS`/`RENAMED_MANAGED_ASSETS`/`migrateRenamedManagedAssets`/`removeRetiredManagedAssets`、`updatePackageManagedSddAgentOwnership`/`hasPackageAssetOwnerInstallation`/`isPackageManagedSddAsset` | ~600 |
| `sdd-preflight-preferences.ts` | 74-146, 179-248, 572-632 | 偏好类型与规范化：`SddExecutionMode`/`SddDeliveryStrategy`/`SddChainedPrStrategy`/`SddPreflightField`、`normalizeSddArtifactStore`/`normalizeSddChainedPrStrategy`/`normalizedSelections`、会话内存缓存（`sddPreflightBySession`/`sddPreflightInFlight`）、`sddPreflightDiskPath`/`readSddPreflightFromDisk`/`writeSddPreflightToDisk`、`DEFAULT_SDD_PREFLIGHT` | ~250 |
| `sdd-preflight-intent.ts`（或并入现有 sdd 模块） | 891-1132 | 意图识别与交互流程：`hasAffirmativeSddIntent`/`isSddPreflightTrigger`/`sddPreflightSessionKey`/`hasWritableMemoryTool`/`collectSddPreflightPreferences`/`isParentConfirmedSddPreflightContext`/`extractParentConfirmedSddPreflightContext`/`renderSddPreflightPrompt`/`ensureSddPreflight`/`getSddPreflightPreferences` | ~240 |

依赖方向：managed-assets ← preferences ← intent（intent 的 `collectSddPreflightPreferences` 读写偏好与资产）。
`SHIPPED_SDD_AGENT_NAMES` 被 `extensions/jero-ai.ts:47` import，拆出后需同步 import 路径。

## 文件级问题清单

### P1

1. **跨文件重复：`PACKAGE_ROOT` / `ASSETS_DIR` 三处独立定义**
   - `lib/jero-ai-package-assets.ts:14,16`（export）
   - `lib/sdd-preflight.ts:11,12`（私有）
   - `extensions/jero-ai.ts:224,225`（私有）
   三份语义相同但互不共享。`ASSETS_DIR` 的计算依赖 `import.meta.url`，在**不同目录层级**的文件里 `dirname(dirname(...))` 恰好都解析到包根——但 `lib/` 与 `extensions/` 层级相同才成立，这是**隐式的位置耦合**：任何文件移动到不同深度（例如 `lib/authority/`）都会得到错误路径。建议下沉 `lib/package-paths.ts` 并全部 import。**这也是 TDZ 隐患#1 的根治手段。**

2. **跨文件重复：`hasWritableMemoryTool` 三处独立实现**
   - `lib/jero-ai-sdd-startup.ts:278`（export）
   - `lib/sdd-preflight.ts:929`（私有）
   - `extensions/jero-ai.ts:1866`（私有）
   同功能（探测 pi 是否有可写的 memory 工具）三份拷贝。`sdd-preflight.ts:929` 那份只在 `collectSddPreflightPreferences` 内用来自动判定 artifactStore。建议统一 import 一份。

3. **跨文件重复：`isRecord` 五处独立实现**
   `lib/review-transaction.ts:1509`、`lib/review-candidate-view.ts:1637`、`lib/jero-ai-persona-config.ts:11`(export)、`lib/sdd-preflight.ts:182`、`extensions/jero-ai.ts:2010`。建议下沉 `lib/record-utils.ts`。

### P2

4. **sdd-preflight.ts:625-629 — `writeSddPreflightToDisk` 静默吞掉写盘失败**
   ```ts
   } catch {
       // 磁盘写入失败非致命；内存缓存是主存储
   }
   ```
   注释说明了意图（内存缓存为主），但**完全无日志、无返回值**。用户以为偏好已持久化，下次会话却丢失。建议至少 `ctx.ui?.notify?.(..., "warn")` 或返回 boolean 让调用方决定。

5. **sdd-preflight.ts:294-296 — `waitForManagedAssetsLock` 用 `Atomics.wait` 同步阻塞，可冻结 TUI 最长 5 秒**
   ```ts
   function waitForManagedAssetsLock(milliseconds: number): void {
       if (milliseconds <= 0) return;
       Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
   }
   ```
   `acquireManagedAssetsLock`(305) 在 `wx` 打开失败（EEXIST）后于**同步 for(;;) 循环**中调用它（338），直到 `MANAGED_ASSETS_LOCK_TIMEOUT_MS = 5000`（14-17 行）超时。`Atomics.wait` 会让出 CPU 但**阻塞整个 Node 事件循环**——期间 TUI 无渲染、无输入响应。
   调用点：`withManagedAssetsLock`(352) ← `updatePackageManagedAssetOwnership`(499) 与 `installPackageAssets`(836)，最终由 `extensions/jero-ai.ts:8505/8516/8781` 与 `extensions/sdd-init.ts:778` 触发，均在**用户命令路径**（`/jero:*` 命令、SDD 预检）而非纯启动期。
   实际风险：仅在**并发**触发时才有长阻塞（无竞争时第一次 `writeFileSync` 就成功，零等待）——正常单会话使用不会感知；但如果用户同时开两个 Pi 会话、或在另一进程正安装资产时触发命令，UI 会卡住数秒。
   修法：改为 async 版本（`await new Promise(r => setTimeout(r, retryMs))`），并把 `acquireManagedAssetsLock`/`withManagedAssetsLock`/`installPackageAssets` 整链改 async。`installPackageAssets` 目前是同步签名，被 3 个调用点使用，改造波及面中等。
   附带：`holdLockMs`（359 行）是**测试注入的刻意持锁时长**，生产调用不传 → 0，无影响。

6. **sdd-preflight.ts:899-911 — 意图识别的中英混合正则**（见文件内容）
   `hasAffirmativeSddIntent` 用一条很长的正则匹配中英文祈使标记。中文分支 `需要`/`想要` 是宽泛词——"这需要 SDD 吗？"这类疑问句会被误判为触发。当前无法从代码判断这是否已被测试覆盖；建议补一条疑问句反例测试。

## 死代码清单

1. **`lib/jero-ai-*.ts` 全部 15 个新模块（约 4500 行）** — 零生产/测试消费者（已验证：`tests/` 与 `extensions/` 中 grep `jero-ai-writer-scope|jero-ai-guardrails|jero-ai-model-config|jero-ai-sdd-startup|jero-ai-package-assets|jero-ai-persona-config` 全部无命中）。**本仓库当前最大一笔死代码**，且已开始漂移（见下）。
2. **新模块与扩展的 118 个重复符号** — 全部落在 stage1 区域（223-4278），区域外 0 个（已程序化核验）。扩展内的旧定义是**唯一活代码**，新模块是死拷贝。
3. **`lib/jero-ai-model-config.ts:9` 等 4 处悬空 import** — `readModelRoutingAuthority`/`readModelRoutingAuthorityAsync` 在 `model-routing-authority.ts` 里的真实名字是 `readSavedModelConfig`/`readSavedModelConfigAsync`（见 `extensions/jero-ai.ts:58-59` 的别名 import）。说明 `fix-imports.mjs` 的机械重写**改错了名字**。
4. **`lib/jero-ai-rdd-status.ts:233` `ReviewAssessInput` 未定义** — 该 interface 仍留在 `extensions/jero-ai.ts:4443`，未随 `resolveReviewAssessmentPlan` 一起迁移。

## 死代码漂移的实证（P0 依据）

`node scripts/check-types.mjs` 当前**失败**：

```
types: 4 file/code pair(s) report more diagnostics than recorded:
  +2  lib/jero-ai-model-config.ts TS2305  ... has no exported member 'readModelRoutingAuthority'.
  +1  lib/jero-ai-model-panel.ts TS2305   ... 'readModelRoutingAuthorityAsync'.
  +1  lib/jero-ai-model-routing-apply.ts TS2305 ... 'readModelRoutingAuthorityAsync'.
  +1  lib/jero-ai-rdd-status.ts TS2304   Cannot find name 'ReviewAssessInput'.
types: total 5 exceeds the recorded 0
```

基线是 `total: 0`（本仓库类型已清零）——**这 5 个错误全部由未完成的拆分引入，且因模块是死代码而未被测试发现**。这直接证明：半途拆分已经破坏了仓库的类型门禁，必须先收口（剥离或回滚），再做后续拆分。
