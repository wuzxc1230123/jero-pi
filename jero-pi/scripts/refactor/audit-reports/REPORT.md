# jero-pi 代码审核总报告

日期：2026-09-23 ｜ 范围：`jero-pi/jero-pi` 全仓（106,381 行 TS，lib/ + extensions/ + tests/）
产出方式：6 个并行审核代理 + 主会话程序化核验（类型门、重复符号扫描、循环依赖 TDZ 分析）

---

## 一、结论摘要

**审核判定：仓库当前处于"拆分半途"的破损状态，必须先收口，再谈优化。**

三条实证：

1. **`extensions/jero-ai.ts` 9042 行**，是仓库唯一超 1000 行的扩展文件；`lib/` 侧另有 5 个文件超 1000 行（wire-contract 2834、client-contract 1540、review-transaction 1967、review-candidate-view 1874、sdd-preflight 1132）。
2. **15 个已提取的新模块（约 4500 行）零消费者**——是死代码。`scripts/refactor/` 里的 `split-jero-ai.mjs` / `strip-extension.mjs` / `fix-imports.mjs` 三步只跑了第一步：新模块生成了，扩展体从未剥离。
3. **仓库类型门禁已经失败**：`node scripts/check-types.mjs` 报 5 个 error（基线是 `total: 0`），全部来自这 15 个死模块里的悬空 import / 未定义符号。因为模块是死的，测试发现不了。

同时程序化核验证明了一个**好消息**：新模块间的循环依赖（model-config ↔ model-routing-apply 等 10 条环）**没有真实 TDZ 高危点**——跨环引用全部是函数声明（hoisted）或类型（擦除），唯一的顶层 const 跨环引用（`jero-ai-prompts.ts:21` 用 `PACKAGE_ROOT`）当前安全。所以**剥离是安全的**，不需要先重构依赖图。

---

## 二、P0：必须先做的收口（本轮重构的前置）

### P0-1 完成 `jero-ai.ts` stage1 剥离（消除 4500 行死代码 + 5 个类型错误）

**事实核对**（已程序化验证）：
- 118 个重复符号**全部**落在 stage1 区域（223-4278），区域外 0 个 → `strip-extension.mjs` 能全部清掉。
- 扩展 import 区（1-222）**未 import 任何新模块**。
- `extensions/jero-ai.ts` 自身 typecheck **干净**（0 error）——错误全在未使用的新模块里。

**执行前必须先修 3 处缺陷**（否则剥离后立刻坏）：

| # | 位置 | 问题 | 修法 |
|---|---|---|---|
| a | `lib/jero-ai-model-config.ts:9`、`jero-ai-model-panel.ts:7`、`jero-ai-model-routing-apply.ts:8` | `fix-imports.mjs` 把名字改错了：真实导出名是 `readSavedModelConfig`/`readSavedModelConfigAsync`（见 `extensions/jero-ai.ts:58-59` 的别名），脚本却写了 `readModelRoutingAuthority`/`readModelRoutingAuthorityAsync` | 改 import 名（3 文件 4 处） |
| b | `lib/jero-ai-rdd-status.ts:233` | `ReviewAssessInput` 未随 `resolveReviewAssessmentPlan` 迁移，该 interface 仍在 `extensions/jero-ai.ts:4443` | 把 interface 移到 `jero-ai-rdd-status.ts` 并 export |
| c | `full-plan.json` 的归属表 | 与实际 lib 落点不符：`PACKAGE_ROOT`/`gentlePiAgentHome`/`packageAssetAudit` 被指派给 model-config，实际在 package-assets；`resolveBackgroundSubagentsCapability`/`renderBackgroundSubagentsStatusLine` 被指派给 rdd-status，实际在 writer-scope:470/486 | 按实际落点更新计划表，否则脚本按表机械剥离会切错 |

**剥离时的两个必须同步项**（审核代理发现）：

- **`__testing` 导出表（8066-8116）**：整表 ~40 项全指向本地旧定义。剥离后必须改为 re-export 新模块符号，否则大量测试失效。
- **`guardrailsProcessEnv` 双可变单例（P0 隐患）**：扩展 1587 行定义 / 1595 行读取 / 8178 行赋值；`lib/jero-ai-guardrails.ts:312` 另有一份 `export let`，被同模块 `loadRuntimeGuardrailsConfig`(322) 读。剥离后 `confirmCommand`(8772) 切到 lib 版，则 `dependencies.processEnv` 注入**静默失效**（`JERO_PI_AUTONOMOUS_MODE=1` 的测试注入会读真实 `process.env`）→ 自主模式门可能被绕过或误拒。**修法：装配区 import 并赋值 lib 的绑定，或给 lib 加显式 setter。**
- **跨扩展引用**：`extensions/sdd-init.ts:9` 的 `import { applySavedModelConfig } from "./jero-ai.ts"` 须改指 `../lib/jero-ai-model-routing-apply.ts`。

**验收**：`node scripts/check-types.mjs` 回到 0 error；`pnpm test` 全绿；`extensions/jero-ai.ts` 从 9042 → ~4300 行。

### P0-2 若剥离风险不可控，退路是**回滚新模块**

如果 stage1 剥离因测试锚点（`__testing`）牵连过广而无法一次完成，**更安全的选择是删除那 15 个死模块**，让仓库回到拆分前的干净状态（9042 行但 0 类型错误），再从零以"小步 + 每步过测试"的方式重做。**最不该做的是维持现状**：死代码 + 破掉的门禁 + 双源漂移（`guardrailsProcessEnv` 已经漂了）。

---

## 三、1000 行规则的完整达标清单

目标：**每个文件 ≤ 1000 行**。当前 11 个文件超标：

### 扩展层（4 个）

| 文件 | 行数 | 拆分方案 | 来源 |
|---|---|---|---|
| `extensions/jero-ai.ts` | **9042** | ①stage1 剥离 → ~4300；②评审域 4283-8063 拆 7 个 `lib/jero-ai-review-*.ts`（controller-params / native-ops / consent-store / relay-exec / transport / select / controller-op）；③装配区留守 | 扩展UI域报告 |
| `extensions/jero-agents.ts` | 1457 | ①`lib/agents-remediation.ts`(54-331)；②`extensions/jero-agents-child.ts`(509-682)；③`lib/agents-completion-flush.ts`(796-866)；④保留父侧装配 | 扩展UI域报告 |
| `extensions/startup-banner.ts` | 1062 | ①`lib/banner-logo-model.ts`(31-352)；②`lib/banner-config.ts`(9-101)；③`lib/banner-stats.ts`(492-543)；④`lib/banner-render.ts`(384-531)；⑤保留命令注册+动画编排 | 扩展UI域报告 |
| `extensions/sdd-init.ts` | 816 | **未超标**，但建议拆（仅 45 行是装配）：`sdd-init-detect.ts`(13-302) / `-detect-stack.ts`(310-655) / `-render.ts`(656-770)，保留默认导出 <60 行。顺带清掉 `:11 type ExtensionAPI = any` | 扩展UI域报告 |

### lib 层（7 个）

| 文件 | 行数 | 拆分方案 | 来源 |
|---|---|---|---|
| `lib/authority/wire-contract.ts` | **2834** | 4 文件：`-enums.ts`(4-256) / `-interfaces.ts`(258-620) / `-decode-status.ts`(1810-2310) / `-decode-last-event.ts`(2396-2834) | authority 报告 |
| `lib/review-transaction.ts` | **1967** | 3 文件：`-schema.ts`(1-1072) / `-store.ts`(1084-1499) / `-gate.ts`(1500-1967)。依赖单向 schema←store←gate | 评审核心报告 |
| `lib/review-candidate-view.ts` | **1874** | 3 文件：`-git.ts`(1-984) / `-registry.ts`(984-1628) / `-context.ts`(1628-1874) | 评审核心报告 |
| `lib/authority/client-contract.ts` | **1540** | 3 文件：`-enums.ts`(35-680) / `-interfaces.ts` / `-risk.ts`(661-736) | authority 报告 |
| `lib/sdd-preflight.ts` | **1132** | 3 文件：`-managed-assets.ts`(~600) / `-preferences.ts`(~250) / `-intent.ts`(~240) | lib 其余报告 |
| `lib/agents-runner.ts` | 1078 | 3 文件：`-remediation.ts`(~75) / `-child.ts`(~110) / 保留类主体(~700) | 代理运行器报告 |
| `lib/review-host-relay.ts` | 784 | **未超标**，无需拆 | — |

### 测试文件（5 个超标，优先级最低）
`tests/review-candidate-view.test.ts` 2674、`jero-agents.test.ts` 2322、`review-controller-native-routing.test.ts` 2258、`jero-ai.test.ts` 1919、`package-manifest.test.ts` 1606。测试不在生产路径，建议最后处理。

---

## 四、真实 Bug 清单（按严重度）

### P0
1. **`guardrailsProcessEnv` 双单例** → 见 §二 P0-1。**这是唯一会因剥离而立即生产生效的缺陷。**

### P1
2. `extensions/startup-banner.ts:717-752` — `setHeader` 工厂每次重建 `setInterval` 与 `process.stdout.on("resize")`；`state.timer` 有 `clearInterval` 防护，**`state.resizeHandler` 没有** → 重复进入工厂会累积 stdout resize 监听器（旧 handler 仍引用已 dispose 的 tui/state，触发 `requestRender`）。修法：752 行前加 `if (state.resizeHandler) process.stdout.off("resize", state.resizeHandler)`。
3. `lib/agents-runner.ts:815-821` — `armStall` 只在**入站** RPC 复位看门狗；`send()`(685-694) 出站命令不复位 → 子进程静默长任务（无流式输出的长 bash）会被误判 "stalled" 杀掉。修法：`send()` 成功后也 `armStall`，或改语义为"距上次双向活动"。
4. `lib/agents-runner.ts:386-398` — `JsonLines.push()` 的 `this.buffer` 无界累积；子进程持续输出不含 `\n` 的超长行 → 内存无限增长。修法：buffer 超 1MB 阈值即报错/终止。
5. `lib/agents-runner.ts:473+1037` — `remediationFinalizers` Map 仅在 `finish()` 删除；若 `launch()` 内 `store.add`/`store.update` 抛错则条目永久泄漏。修法：`run()` 内 try/catch 兜底 delete。
6. `lib/agents-view.ts:71 / 383 / 471` — `SESSION_FINISHED_TTL_MS` 生产零消费（仅测试 import）；`inScope(task, _now)` 忽略 `_now`；`render():383` 的 `some(...)` 恒 false 属**死分支**。三者是同一处未完成的设计：TTL 过滤从未实现。修法：要么实现（`now - task.endedAt < TTL`），要么删常量+死分支+改测试。
7. `lib/agents-view.ts:748` — `footer()` 宽度用 `label.length`（UTF-16 码元）而非 `visibleWidth` → 标签含中文/全角时错位。当前标签全 ASCII 故恰好正确，**这是本仓库中文化后的定时炸弹**。
8. `lib/authority/finalize.ts:291` — `A && B || (A && C)` 靠运算符优先级存活，`input.review_result !== undefined` 重复两次。逻辑当前正确但极脆。修法：提 `const hasReviewResult = ...` 并加括号。
9. `lib/review-transaction.ts:1757-1820` — `inspectGateTarget` 的 PULL_REQUEST / RELEASE 两个分支**整体少一级缩进**（功能正确，是机械拆分的疤痕）；任何按缩进切块的脚本（**含本仓库自己的 `scripts/refactor/*.mjs`**）在此处会切错。修法：重新缩进。
10. `lib/sdd-preflight.ts:294-296` — `waitForManagedAssetsLock` 用 `Atomics.wait` **同步阻塞事件循环**，竞争下最长 5 秒（TUI 冻结）。仅在多进程并发安装资产时触发。修法：改 async + `setTimeout`，波及 `installPackageAssets` 等 3 个调用点。

### P2
11. `extensions/jero-ai.ts:7143` — `const _useTargetLifecycleRoot = requiresExplicitTargetLifecycleRoot(...)` 计算后从未使用；连带 `requiresExplicitTargetLifecycleRoot`(6092-6094) 可能是死代码。
12. `extensions/jero-ai.ts:7878-7882` — `pending.expiry.unref()` 硬调用；若测试注入的假时钟对象无 `unref` → TypeError。修法：`.unref?.()`。
13. `extensions/jero-agents.ts:1430-1442` — `presence` 在 `publishActivity` 失败后只 dispose 不重建 → 永久 undefined 直到下个 session。
14. `extensions/jero-shell.ts:341` — overlay `setInterval(() => void refresh(), ...)` 的 refresh 未包 try；reject 会让 `custom()` 永不 resolve。
15. `lib/agents-view.ts:282-291 vs 806-812` — `close()` 与 `dispose()` 是两条路径，`close()` 不取消 store 订阅 → 已关闭视图仍被 store 更新驱动渲染。
16. `lib/review-transaction.ts:1707/555/587` — 依赖 `Array.prototype.toSorted`（ES2023）；`package.json` **无 `engines` 字段**声明 Node 下限 → Node 18/早期 20 会 TypeError。
17. `lib/sdd-preflight.ts:625-629` — `writeSddPreflightToDisk` 静默吞写盘失败，用户以为已持久化。
18. `lib/review-host-relay.ts:658-663` — `Promise.allSettled` 后只抛第一个 rejection，其余失败详情被丢弃（正确但难排障）。

---

## 五、跨文件重复（可下沉的公共逻辑）

| 重复项 | 处数 | 位置 | 建议 |
|---|---|---|---|
| `PACKAGE_ROOT` / `ASSETS_DIR` | **3** | `lib/jero-ai-package-assets.ts:14,16`(export)、`lib/sdd-preflight.ts:11,12`、`extensions/jero-ai.ts:224,225` | 下沉 `lib/package-paths.ts`。**同时根治 TDZ 隐患**（§六） |
| `hasWritableMemoryTool` | **3** | `lib/jero-ai-sdd-startup.ts:278`(export)、`lib/sdd-preflight.ts:929`、`extensions/jero-ai.ts:1866` | 统一 import 一份 |
| `isRecord` | **5** | `lib/review-transaction.ts:1509`、`lib/review-candidate-view.ts:1637`、`lib/jero-ai-persona-config.ts:11`(export)、`lib/sdd-preflight.ts:182`、`extensions/jero-ai.ts:2010` | 下沉 `lib/record-utils.ts` |
| `sanitizeTerminalText` **同名异义** | 2 | `extensions/jero-agents.ts:411-413`（转义为 `\xNN`）vs `lib/terminal-theme.ts:14`（stripAnsi+删除） | **改名 `escapeControlChars`**，避免误用 |

另：`lib/authority/wire-contract.ts` 与 `client-contract.ts` 内部的 `decode*` 函数重复"取字段→窄化→带 label 报错"序列（如 `decodeReviewStatusV3` 1905-2056 约 150 行）。建议下沉 `reqString/reqEnum(obj, key, label)` 助手到 `lib/authority/wire.ts`。

---

## 六、循环依赖 TDZ 分析（结论：安全，但有一处理雷）

程序化扫描 15 个 `lib/jero-ai-*.ts` 的 (a) 顶层 `const` 初始化表达式、(b) `class extends` 父类表达式，检查是否引用"能反向到达本模块"的环上模块标识符：

**命中 0 处。** 10 条环路径上全部是函数声明（hoisted）或类型（擦除）。

**唯一的埋雷**：`lib/jero-ai-prompts.ts:21` `const PROVIDER_CONTRACT_MIRROR_ROOT = join(PACKAGE_ROOT, ...)` 是**顶层 const 值**引用环上模块 `jero-ai-package-assets` 的顶层 const。当前安全仅因 package-assets 不（间接）依赖 prompts 求值；**若有人给 package-assets 加一条 import prompts 的语句，立即 TDZ 崩溃**。
**根治**：把 `PACKAGE_ROOT` 下沉到零依赖的 `lib/package-paths.ts`（同时也消掉 §五 的 3 处重复）。剥离后建议做一次依赖分层：`package-paths` → `persona-config` → `prompts`/`guardrails` → 其余。

---

## 七、建议执行顺序

**阶段 0（本轮，阻塞项）**
1. 修 §二 P0-1 表中 a/b/c 三处缺陷 → 跑 `check-types.mjs` 确认回 0。
2. 跑 `strip-extension.mjs`（同步改 `__testing` re-export、`guardrailsProcessEnv` 绑定、`sdd-init.ts` import 路径）→ 扩展 9042 → ~4300，跑 `pnpm test` 全绿。
   - 若测试锚点牵连过广无法一次完成 → 执行 §二 P0-2 回滚，不要维持现状。

**阶段 1（1000 行达标 — lib 层，风险低，独立于扩展）**
3. `review-transaction.ts` → 3 文件（依赖单向，最干净）
4. `review-candidate-view.ts` → 3 文件
5. `wire-contract.ts` / `client-contract.ts` → 各 3-4 文件（纯类型+解码，可并行）
6. `sdd-preflight.ts` → 3 文件 + 顺手做 §五 的 `package-paths` 下沉
7. `agents-runner.ts` → 3 文件

**阶段 2（1000 行达标 — 扩展层）**
8. `jero-ai.ts` 评审域 4283-8063 → 7 个 `lib/jero-ai-review-*.ts`；顺手把 `executeReviewControllerOperation` 的 **12 参数签名（7126-7139）收敛为 options 对象**
9. `jero-agents.ts` / `startup-banner.ts` / `sdd-init.ts` 按方案拆分

**阶段 3（bug 清理，可穿插进行）**
10. P1 清单逐条（建议顺序：guardrailsProcessEnv 已随阶段0 解决 → agents-runner 三条 → startup-banner resize 泄漏 → agents-view TTL 死设计 → finalize.ts 优先级 → review-transaction 缩进 → sdd-preflight 同步阻塞）
11. 跑一次全局未使用导出扫描（knip / ts-prune）清理 §死代码清单里的 export-only 符号

**贯穿原则**（来自仓库既有实践）：每步一个 commit，每步 `check-types.mjs` + `pnpm test` 全绿后再进下一步；类型门是 ratchet（只能缩不能涨），任何"先破后立"的分步都会立即被它抓住。

---

## 八、附：分域报告

- [review-extension-ui.md](review-extension-ui.md) — 扩展入口与 UI 域（jero-ai.ts 残留实证 / jero-agents / startup-banner / sdd-init）
- [review-agents-runner.md](review-agents-runner.md) — 代理运行器 + 视图
- [review-authority.md](review-authority.md) — authority 权威域
- [review-review-core.md](review-review-core.md) — 评审核心三文件
- [review-lib-misc.md](review-lib-misc.md) — lib 其余模块与循环依赖
