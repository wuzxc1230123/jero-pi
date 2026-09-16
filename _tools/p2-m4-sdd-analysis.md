# P2-M4 权威规格：authority.sdd.*（进程内 SDD 状态层）

> 主会话重锚版（2026-09-16）。v0（_tools/p2-m4-sdd-analysis-v0.md）由无本地工具的代理产出，本文已逐条对照本地源修正；标注 [L] 的均已本地验证。
> 路径：GP = gentle-pi-main（只读上游），JP = jero-pi。

## A. 操作契约

### A.1 `authority.sdd.status`（纯投影，不入账）[L]

- 上游请求：`NativeSddStatusRequest { changeName?: string; workspaceRoot: string; signal? }`（GP lib/native-review-cli.ts:199-202）
- 上游结果 `NativeSddStatusV2`（:213-228）：`schemaName:"gentle-ai.sdd-status"`, `schemaVersion:2`, `changeName: string|null`, `artifactStore:"openspec"|"engram"|"hybrid"|"none"`, `planningHome {mode:"repo-local", path}`, `changeRoot: string|null`, `actionContext {mode:"repo-local", workspaceRoot, allowedEditRoots[]}`, `dependencies: Record<七相, "blocked"|"ready"|"all_done">`（七相 = proposal/specs/design/tasks/apply/verify/archive，GP:1461）, `phaseInstructions?`（apply/verify/remediate/archive 四键，GP:1462）, `blockedReasons[]`, `nextRecommended`（12 值枚举，GP:1463）, `remediationState? {required, complete, failedEvidenceRevision}`
- 解码纪律（GP decodeNativeSddStatusV2 :1467-1498，逐条移植）：planningHome.path 必须等于 `join(workspaceRoot,"openspec")` 或（engram/hybrid 时）字面量 `"engram:sdd"`；actionContext.workspaceRoot === 请求根；allowedEditRoots 含请求根且全绝对+规范；dependencies 恰好七键；legacy `instructions` 字段必须缺省；`nextRecommended==="remediate"` ⇒ remediationState.required=true、complete=false、failedEvidenceRevision 非空 sha256:；失败一律 throw（映射为 SCHEMA_INCOMPATIBLE 错误族）
- **M4 实现**：包 JP lib/sdd-status.ts 的 `resolveSddStatus(options): SddStatus`（JP:461，798 行两版一致——TS 侧本就完整拥有从 openspec 树计算状态的逻辑）。authority.sdd.status = resolveSddStatus + 投影到 NativeSddStatusV2 形状（保留 camelCase 与 schema 字符串 `gentle-ai.sdd-status`——移植纪律，改名归 P5）。typed refusal 出口；无 journal 写入。
- argv/超时：上游 `sddProjection`（GP:2211-2225）: status 只读、continue 变更且强制 canonical changeName——语义保留为 API 前置校验（continue 无 changeName → TypeError 等价拒绝）。

### A.2 `authority.sdd.attempt.acquire` [L]

上游 `NativeSddAcquireRequest`（GP:134-146）字段与校验（GP sddAttempt :2147-2204 逐条）：
- 基座（NativeSddAttemptRequest，:134-138）：`workspaceRoot`（绝对+规范）、`changeName`（规范串）、`requestId`（正则 `^[a-z0-9][a-z0-9._-]{0,127}$`）、`untrackedScope/expectedUntrackedInventory/intendedUntracked`（与 START 同三件套，`nativeUntrackedSelectionArguments` 展开进 argv）、可选 `remediatesEvidenceRevision`（sha256:）
- acquire 独有：`workUnit`（≤160 规范串）、`evidenceGoal`（≤240）、`maxAttempts?`（1..100 整数）、`maxChangedLines?`（1..1_000_000）、`expectedRevision?`（sha256: 或字面空串——空串表达"接受尚无 attempt 状态"）、`token?`（≤500，幂等重放用）
- 结果 `NativeSddAttemptResult`（:159-163）：`{state:"proceed"|"blocked"|"complete", token?, reason?}`；acquire+proceed ⇒ token 必为规范串

**M4 契约**：discriminated union 出口（proceed/blocked/complete + typed refusal）。journal 操作名新增 `sdd-attempt-acquire`（见 A.5）。状态保持（attempt 台账）：per (workspaceRoot, changeName) 单活 attempt；expectedRevision 匹配乐观并发（不匹配 → stale 拒绝）；token 由 node:crypto 铸造，**台账存 sha256(token)**；带 token 的 acquire = 幂等重放（返回既有结果，不铸新）。

### A.3 `authority.sdd.attempt.settle` [L]

上游 `NativeSddSettleRequest`（GP:149-157）在基座上加：`token`（必需 ≤500）、`outcome` ∈ `SDD_ATTEMPT_OUTCOME` = **passed|failed|interrupted**（GP:148——v0 的 cancelled/failed/timed_out 是错的）、`evidenceRevision?`、`remediationEvidence?`、`diagnosis`（≤500 必需）、`harnessDisposition:"reused"|"invalidated"`、`cleanupEvidence`（≤500 必需）、`processEvidence`（≤500 必需）。

证据配对规则（GP:2173-2174 的精确布尔式）：
- `interrupted` ⇒ evidenceRevision 与 remediationEvidence 必须皆缺省
- `failed` ⇒ 必须有 evidenceRevision
- `passed` ⇒ 必须有 evidenceRevision 或 remediationEvidence

**M4 契约**：settling 消费活 attempt（token 匹配 sha256 台账）；结果仍为 proceed/blocked/complete 形状（上游 settle 后 follow-up 由再次 acquire 驱动，`complete` = attempt 预算耗尽/无需更多）。单次终结（append-only）；重放按 requestId 幂等。journal 操作名 `sdd-attempt-settle`。

### A.4 `authority.sdd.continue`

- 输入 `{changeName, workspaceRoot}`（changeName 必需规范）；输出 = status 投影（变更后）+ journal 操作 `sdd-continue`
- 契约条款（JP assets/support/sdd-status-contract.md:22 [L]）：只有显式 sdd-continue 可补 change-instance 标记（`ensureChangeInstanceMarker` 无 status 调用方，唯一生产路径 PrepareChangeInstanceConsent）
- 转移合法性来自 resolveSddStatus 投影；非法 → typed refusal（UNSUPPORTED_TRANSITION_OPERATION 等价）

### A.5 journal 操作名 [裁定]

`JERO_AUTHORITY_OPERATIONS`（JP protocol.ts:477 现有 9 员）追加三个：`sdd-attempt-acquire`、`sdd-attempt-settle`、`sdd-continue`；status 不入账（纯读）。封闭枚举经审核式追加（同 M2 的 acknowledge/apply-fix 先例）。

## B. SDD 绑定工件 [L——本地 fixture 已纠正 v0]

本地 `JP tests/fixtures/native-review-cli/v2.1.3/bind-sdd.json` 真实形状：`schema:"gentle-ai.sdd-review-binding/v1"`, `revision`(sha256:), `change`(**字符串**，非对象), `lineage`(**字符串**), `authority_revision`(sha256:), `receipt_hash`(sha256:), `gate_context`（必需集 gate/lineage_id/generation/base_tree/candidate_tree/paths_digest/fix_delta_hash/policy_hash/ledger_hash/evidence_hash/base_relationship_valid + 可选 store_revision/genesis_revision/chain_identity/bundle_digest——同 M1 分析的 gate-context 解码器）。

**M4 映射**：血统 sidecar（judgment-ledger 同机制，M3 MA1 修正模式）：载入时重算规范哈希（去 revision+receipt_hash 的 carve 集）、交叉核对 lineage/generation/changeName、authority_revision 对账 ledger 头；不符 → typed refusal（stale-binding/tampered-binding），**quarantine-not-delete**（保留审计痕迹）。schema 字符串保留 gentle-ai 前缀至 P5。

## C. verify-report.md 信封（jero.verify-result/v1）[L]

解码器已在 JP protocol.ts:560-615（M1 产物），字段：`schema, evidence_revision(sha256:), verdict(pass|fail), blockers, critical_findings, requirements("<n>/<m>" 比率), scenarios(比率), test_command, test_exit_code, test_output_hash(sha256:), build_command, build_exit_code, build_output_hash(sha256:)`。**不新建解码器，import 之**。

有意分歧记录：上游最新版已弃 verify-result/v1 准入，jero-pi 按 §5.1.8 在 jero.* 命名下重立——模块头注释声明。M4 补 markdown/YAML 抽取（M1 时显式留给 SDD 里程碑）：从 verify-report.md 文本提取信封字段的严格解析器（report 是 SDD verify 阶段工件，位于 change root）。

settle 验证：`passed` 结算时若呈交 verify-result → 进程内校验（解码 + evidence_revision 新鲜度对 acquire 时点 + scope ⊆ attempt 范围）；失败分类：missing-evidence/unreadable-evidence/malformed-envelope/schema-mismatch/identity-mismatch/stale-evidence/scope-mismatch，全为 typed refusal；`failed|interrupted` 不要求证据。

## D. attempt 生命周期纪律 [L——契约条款在本地 sdd-status-contract.md:66-70]

- **attempt 权威与 status 分离**（:66）：artifact-store 无关（openspec/engram/hybrid/none 同纪律）；状态 schema 绝不携带 attempt token/计数器；Pi 不建不镜像 OpenSpec/Engram attempt 台账
- **acquire 先于运行**（:68）：每次 runtime-bearing 的 sdd-apply/sdd-verify/remediation 启动前必须 acquire；外部运行结束后必须 settle；**acquire 与 settle 的 requestId 不同**；同操作幂等重放才复用自身 requestId；路由只认 proceed|blocked|complete——仅 proceed 可启动；reset 绝不自动（维护者显式，归 M5）
- 台账持久化在 jero 权威存储（lineage 侧或 store 级 attempt 台账文件，实现者按 M3 sidecar 模式选）；崩溃窗：acquire journal 条目 flush 后才可变更（R1）；token sha256 先于 actor 准入（R2）；blocked 携带既有 attempt 身份；单次终结（R3）；终态 verbatim 保留 untrackedScope（R4）
- 注意：tests/sdd-managed-runtime-settlement.test.ts 是**扩展侧**（agents-runner 的 remediation 观测机械 → 驱动 attempt API）的契约测试，15 挂为 Windows 基线；M4 不动它，P4 接线时它驱动 authority.sdd.attempt

## E. 集成面（M4/P4 边界）[L]

- lib/sdd-preflight.ts 不调二进制（装代理资产/规范化偏好/仅门禁二进制存在——ENOSDD 路径在零二进制下成死代码，留改名期清理）；lib/sdd-status.ts 只有类型引用
- 真正调用面在扩展模板（tests/sdd-agent-tools.test.ts：sddStatus 工具 {passThrough:"agent-stdio-filter:off"} + 单必需参 {sdd_selection}；sddContinue {manage:"change"} 默认 none；禁被动捕获工具调用）
- **M4 只落 lib/authority/sdd-* 模块 + 测试**；模板改线归 P4（§9.1 边界门：extensions 不得 import authority 内部——P4 走 review.ts 门面导出面）

## F. 模块分解（JP lib/authority/）

1. `sdd-status.ts` — authority.sdd.status：包 resolveSddStatus + v2 投影 + 严格解码纪律（A.1 规则作为投影自检）；无 journal
2. `sdd-attempt.ts` — acquire/settle（A.2/A.3/D）：台账 sidecar、token sha256、证据配对布尔式、单活、幂等
3. `sdd-continue.ts` — 变更转移（A.4），change-instance 标记语义
4. `sdd-binding.ts` — 绑定工件写/验（B）：carve 哈希、交叉核对、quarantine
5. `verify-report.ts` — verify-report.md 的 markdown/YAML 抽取 → decodeJeroVerifyResultV1（C）
- 门面扩展：review.ts 增 authority.sdd.{status,attempt.acquire,attempt.settle,continue} 导出
- protocol.ts：JERO_AUTHORITY_OPERATIONS +3（审核式）；attempt 台账 typed 记录 + 严格解码（同 correction_evidence 先例）

## G. 测试计划

1. sdd-status：投影自检矩阵（planningHome 逃逸/engram 字面量/七相/legacy instructions/remediation 不变式/nextRecommended 枚举）
2. attempt：acquire 校验矩阵（requestId 正则/长度上限/maxAttempts 边界/expectedRevision 空串语义）；证据配对三分支；token 幂等重放；单活 blocked；stale expectedRevision；settle 单次终结 + verbatim untrackedScope；崩溃窗（journal flush 先于状态可变更——用 prepare/complete 对）
3. binding：篡改/陈旧/身份不匹配 → quarantine-not-delete 断言（fixture 形状驱动）
4. verify-report：合法信封接受；taxonomy 七类拒绝；passed 无证据拒绝、interrupted 带证据拒绝
5. 既有测试不动：sdd-preflight/sdd-status/sdd-agent-tools/delegated-key-learnings/sdd-selection-transport/rdd-aware-verification/sdd-*-routing-contract/sdd-managed-runtime-settlement（后者 Windows 基线 15 挂维持）

## v0 勘误记录（重锚发现）

1. bind-sdd.json：change/lineage 是字符串，v0 说是对象 {changeName,evidencePath}/{id,generation}——CDN 旧版形状
2. SDD_ATTEMPT_OUTCOME = passed/failed/interrupted，v0 的 cancelled/timed_out 来自扩展层 settlement 测试名，非 native 契约
3. settle 有必填 diagnosis/harnessDisposition/cleanupEvidence/processEvidence 四件，v0 全漏
4. acquire 有 workUnit/evidenceGoal/maxAttempts/maxChangedLines/expectedRevision（含空串语义），v0 全漏
5. 本地 sdd-status.ts 798 行且 resolveSddStatus 完整拥有状态计算（v0 的"31KB/1.8KB 缓存疑虑"不成立，两版一致）
6. 上游公网镜像无 sdd-attempt 操作的 DISCREPANCY #1：本地确有（GP:70-72, 128-131, 2139+）
