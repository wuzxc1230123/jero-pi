# 扩展入口与 UI 域审核报告

## jero-ai.ts 拆分残留（重复符号证据 + 剩余部分拆分方案）

**状态判定：新模块已建（lib/jero-ai-*.ts，15 个文件），但扩展体从未被剥离。** `scripts/refactor/strip-extension.mjs`（阶段1收尾脚本）和 `fix-imports.mjs` 都写好了却从未运行——extensions/jero-ai.ts 第 223-4278 行仍完整保留全部已迁移区域，第 1-222 行 import 区也完全没有 import 任何 `../lib/jero-ai-*.ts`。usage-map.json 显示 450 个符号在计划内，其中 255 个落在 15 个已迁移区域里。扩展当前全靠本地旧定义运行；新 lib 模块的唯一消费者是它们自己互引——**新模块在生产路径上是死代码**。

**逐字节相同的重复证据（抽查确认，均为 100% 相同拷贝，仅差 `export` 关键字）：**
- `evaluateGuardedCommand` 扩展 1489-1517 行 vs `lib/jero-ai-guardrails.ts:189` — 逐字节 diff 验证相同。
- `gentlePiAgentHome`/`packageAssetAudit`/`packageAssetDiagnosticLines`/`localAgentOverrideCount` 扩展 227-321 行 vs `lib/jero-ai-package-assets.ts:20-119` — 逐字节相同。
- `hasWritableMemoryTool` 扩展 1866-1884 行 vs `lib/jero-ai-sdd-startup.ts:278-296` — 相同。
- `isRecord` 扩展 2010 行 vs `lib/jero-ai-persona-config.ts:11` — 相同。
- 常量簇：`GRAPH_V1_ORDINARY_READ_ONLY`/`PACKAGE_ROOT`/`ASSETS_DIR`（223-225）、`DEFAULT_BACKGROUND_SUBAGENTS_RENDERING`（364）、`RDD_STATUS_TIMEOUT_MS`/`RDD_STATUS_MEMO_TTL_MS`（973/978）、`PERSONA_OPTIONS`（1296）、`PATH_GUARDED_TOOL_NAMES`/`PATH_INPUT_KEYS`/`SENSITIVE_PATH_PATTERNS`（1634-1653）、`SDD_AGENT_NAME_SET`/`SDD_CHANGE_FLAG`/`CORE_MODEL_AGENT_NAMES`（1654-1668）、`KEEP_CURRENT`/`INHERIT_MODEL`/`THINKING_OPTIONS`/`MODEL_CONTROL_OPTIONS`（1678-1694）、`MODEL_EXPORT_KIND`/`MODEL_EXPORT_VERSION`（2026-2027）、`PANEL_TONE_COLOR`（2900）——全部在对应 lib 模块中有 export 版。
- 面板/命令：`SddModelPanel` 类（2909-3357）+ `handleModelsCommand`（3391）vs `lib/jero-ai-model-panel.ts`；`ProfilesPanel` 类（3543-3854）+ `handleProfilesCommand`（4197）vs `lib/jero-ai-profiles-panel.ts:739`；`handlePersonaCommand`（4258）vs `lib/jero-ai-persona-command.ts:11`。

**扩展内仍引用本地旧定义的具体位置**（共 100 行引用、67 个去重符号，集中在装配区与 __testing）：
- `__testing` 导出表 8066-8116 行：整表全部指向本地旧定义——**测试锚点全部绑在旧代码上**，剥离后必须把 __testing 改为 re-export 新模块符号。
- 运行时装配区：`createHerdrConfirmationLifecycle`（8187）、`guardrailsProcessEnv` 赋值（8178）、`isSddAgentStartEvent`（8567）、`sddPhaseFromAgentStartEvent`（8592）、`readSddChangeFlag`（8593）、`resolveSelectedNativeSddChangeStartup`（8605）、`buildGentlePrompt`（8635）、`readPersonaMode`（8636）、`resolveRddStatusLine`+`RDD_STATUS_TIMEOUT_MS`（8639）、`loadReviewContractPromptFragment`（8647）、`evaluateSensitivePathTool`（8706）、`sddDispatchAgentName`（8712）、`rejectInvalidJudgmentDayFixDispatch`（8754）、`rejectUnscopedBoundedWriterDispatch`（8756）、`confirmCommand`（8772）、`handleModelsCommand`（8869）、`handleProfilesCommand`（8876）、`handlePersonaCommand`（8883）、`packageAssetDiagnosticLines`（8890/9015）、`readSavedModelConfigAsync`（8897）、`hasWritableMemoryTool`（8898）、`resolveBackgroundSubagentsPolicy`/`writeGlobalBackgroundSubagentsPolicy`/`resolveBackgroundSubagentsCapability`/`renderBackgroundSubagentsReport`（9001-9004）、`gentleAiConfigHome`（8973）、`describeModelConfig`（9031）、`applySavedModelConfig`/`applyModelConfig`（8505/8518）、`migrateLegacyProjectModelOverrides`（8517）。
- 评审域内残留引用：`isRecord`（4308、4518、4592 等 17 处）、`resolveReviewAssessmentPlan`（7166）、`recordNativeReviewOutcome`（7611/7632）、`GRAPH_V1_ORDINARY_READ_ONLY`（7991）。
- 跨扩展引用：extensions/sdd-init.ts:9 `import { applySavedModelConfig } from "./jero-ai.ts"` — 剥离后须改指 `../lib/jero-ai-model-routing-apply.ts`。

**拆分计划自身的归属错配（full-plan.json vs 实际 lib 落点）**：plan 把 `PACKAGE_ROOT`/`gentlePiAgentHome`/`packageAssetAudit` 指派给 jero-ai-model-config，实际落在 jero-ai-package-assets；plan 把 `resolveBackgroundSubagentsCapability`/`renderBackgroundSubagentsStatusLine` 指派给 jero-ai-rdd-status，实际落在 jero-ai-writer-scope.ts:470/486。脚本若按计划表机械剥离需先对齐实际归属。

**剩余部分（4283-9042）拆分方案**：
1. `lib/jero-ai-review-controller-params.ts`（4283-4690）：REVIEW_CONTROLLER_OPERATION、四套工具参数 schema（CONTROLLER/CAPTURE/CAPTURE_GROUP/SCOPE）、parse 系列。纯 schema+parse，无依赖，最好剥。
2. `lib/jero-ai-review-native-ops.ts`（4691-5358）：authorizeDestructiveReviewOperation、review-mode 门（4809-4898）、native status/maintenance/recovery 路由（4899-5095）、mapNativeStartResult/TargetStatus、start policy 路径校验（5193-5358）。
3. `lib/jero-ai-review-consent-store.ts`（5359-6101）：PendingReviewConsentRegistry 类（5394-5475）、进程级注册表、保留选择 Map、同意生命周期辅助（5496-5660）、retain/read/clear 选择函数族（5973-6094）。注意含进程级可变单例（5476-5485），搬迁即语义搬迁。
4. `lib/jero-ai-review-relay-exec.ts`（6103-7125）：relay runner 接缝（6103-6122）、capture/capture-group 执行（6259-7012）、provider 角色向量（6444-6513）、hydrateDispatchBindingFromStatus。
5. `lib/jero-ai-review-transport.ts`（6553-6731）：transport 探测 WeakMap（6564）、协商 status（6603-6662）、capture binding 解析（6666-6731）。
6. `lib/jero-ai-review-select.ts`（6732-7125 余部 + 6874-7099）：selectExactReviewCapture/Group、captureGroupAuthorityDrift。
7. `lib/jero-ai-review-controller-op.ts`（7126-8063）：executeReviewControllerOperation 主开关——**12 个参数的扫把星签名（7126-7139）**，拆时应顺手收敛为 options 对象。
8. extensions/jero-ai.ts 最终应只剩：__testing re-export 表、JeroRuntimeDependencies、createJeroAiExtension、gentleAi 装配函数（8179-9038，约 860 行事件/工具/命令注册）。若仍嫌大，可再按域拆 extensions/ 薄装配文件。

## jero-agents.ts 拆分建议（1457 行）

单文件装了四个不相关域，建议四分：
1. `lib/agents-remediation.ts`（54-331，约 280 行）：SDD_PHASE_BY_AGENT、parseSddChange、REMEDIATION_SCHEMA、confirmRemediationScope、remediationToolAllowed、reconcileManagedRemediation、admitManagedRemediation、remediationBash。
2. `extensions/jero-agents-child.ts`（509-682）：研究子代理守卫与 RPC 子进程模式分支。
3. `lib/agents-completion-flush.ts`（796-866）：deliver/deliverStale/flushCompletions/settleCompletion + 四个 agent_* 事件处理器。
4. extensions/jero-agents.ts 保留：常量、env 配置读取、defaultDeps、父侧装配主体。
另：411-413 行本地 `sanitizeTerminalText` 与 lib/terminal-theme.ts:14 的导出版**语义不同**（本地转义控制符为 `\xNN`，lib 版是 stripAnsi+删除）——建议改名 `escapeControlChars`。

## startup-banner.ts 拆分建议（1062 行）

1. `lib/banner-logo-model.ts`（31-352，约 320 行）：TEXT_LOGO/ROSE_LARGE_RAW 素材、computeLogoBounds/buildLetterSpans/buildLetterStrokeMap、LETTER_STROKES/tick 表。
2. `lib/banner-config.ts`（9-101）：PI_AGENT_DIR 常量、BannerConfig、读写 normalize。
3. `lib/banner-stats.ts`（492-543）：countSddAgents/packageNameFromSpec/countPackageExtensions/readGitBranch。
4. `lib/banner-render.ts`（384-531 余部）：buildPenLogoLine、LayoutBuilder、pickIntroMode。
5. extensions/startup-banner.ts 保留：命令注册 + session_start 动画编排。

## sdd-init.ts 拆分建议（816 行）

1. `lib/sdd-init-detect.ts`（13-302）：IGNORED_DIRS、walkProject、detectPackageManagerAt、GENERIC_HINTS 表与各 detect* 前置。
2. `lib/sdd-init-detect-stack.ts`（310-655）：detectNodePackage、detectNode/Go/Rust/Python/GenericHints/Makefile、detectProject 汇总。
3. `lib/sdd-init-render.ts`（656-770）：commandSummary/renderContext/pushCommandList/renderConfig/ensureOpenSpecDirs。
4. extensions/sdd-init.ts 保留默认导出装配即可（<60 行）。另：第 11 行 `type ExtensionAPI = any` 是类型逃逸舱，拆分时应改回真实类型 import。

## 文件级 bug 清单

### P0
1. **extensions/jero-ai.ts 全局 + lib/jero-ai-guardrails.ts:312**：`guardrailsProcessEnv` 双可变单例。扩展 8178 行只写本地副本（1587 行定义、1595 行读取）；lib 版 312 行 `export let guardrailsProcessEnv` 独立存在且新模块的 `loadRuntimeGuardrailsConfig`（322 行）读它。现状下无害（生产只走本地副本），但**一旦按 strip-extension.mjs 剥离并把 8772 行 confirmCommand 切到 lib 版，`dependencies.processEnv` 注入立即静默失效**——JERO_PI_AUTONOMOUS_MODE=1 的测试注入会读真实 process.env，自主模式门可能被绕过或误拒。修法：剥离时在装配区 import 并赋值 lib 的 `guardrailsProcessEnv`，或给 lib 加显式 setter。

### P1
2. **extensions/jero-ai.ts:7143**：`const _useTargetLifecycleRoot = requiresExplicitTargetLifecycleRoot(...)` — 计算后从未使用（全文件唯一出现点）。要么是被剥离消费的守卫残迹，要么 requiresExplicitTargetLifecycleRoot（6092-6094）整体是死代码。修法：确认 intent——若应为校验则补消费，否则删两者。
3. **extensions/startup-banner.ts:717-752**：`ctx.ui.setHeader` 工厂闭包内为每个 session_start 重建 setInterval（723）与 `process.stdout.on("resize")`（752）。`state.timer` 在 719 行有 clearInterval 防护，但 `state.resizeHandler` **没有防护**——重复进入工厂会**累积 stdout resize 监听器**。修法：752 行前加 `if (state.resizeHandler) process.stdout.off("resize", state.resizeHandler)`。
4. **extensions/jero-agents.ts:1430-1442**：session_start 处理器先 `presence?.dispose()`（1434）再 `PresencePublisher.start`（1438），但 `presence.error` 分支（713-718 publishActivity 内）失败后只 dispose 不重建——与 session_start 的重建逻辑不一致，publishActivity 失败一次后 presence 永久 undefined 直到下个 session。若属有意请注释，否则在 publishActivity catch 里允许下轮重建。

### P2
5. **extensions/jero-ai.ts:7878-7882**：`pending.expiry = reviewConsentScheduleTimer(...)` 后紧跟 `pending.expiry.unref()`——当 dependencies.scheduleTimer 注入假时钟，返回对象若无 unref 方法会直接 TypeError。契约收窄不严。修法：`.unref?.()`。
6. **extensions/jero-shell.ts:341**：changes overlay 的 `setInterval(() => void refresh(), deps.pollMs)` 若 refresh 内 throw（`deps.refresh()` 未包 try），未捕获 rejection 会沿 void promise 上抛。修法：refresh 内 catch 并仅 notify。
7. **extensions/startup-banner.ts:649-689**：三个错开的 setTimeout(100/150/200ms) 统计抓取在 session 快速 shutdown 时不取消——属无害但不洁；建议把 timeout id 纳入 state 一并清理。

## 死代码清单

1. **lib/jero-ai-*.ts 全部 15 个新模块（合计约 4500 行）**：当前没有任何生产或测试文件 import 它们。在 strip-extension.mjs 运行之前，它们整体是死代码——**这是本仓库当前最大的一笔死代码**。
2. **extensions/jero-ai.ts:7143 `_useTargetLifecycleRoot`**（见 P1#2）及可能的 `requiresExplicitTargetLifecycleRoot`（6092-6094）。
3. **extensions/jero-agents.ts:378 `legacySubagentsInstalled`**：export 但扩展内只用私有的 `legacySubagentsInstalledAt`（692 行）。
4. **extensions/startup-banner.ts:373-382 `warmupLetterStrokes` 的 warmupStarted 一次性闸**：与 LETTER_STROKES 的 per-letter null 检查冗余——微死代码。
5. **extensions/sdd-init.ts:11 `type ExtensionAPI = any`**：类型债。
6. **lib/jero-ai-path-guard.ts**：三个常量目前在 lib 内只被 jero-ai-sdd-startup.ts:14 import——而 sdd-startup 整体也是死的（见#1），所以当前实际消费为零。
