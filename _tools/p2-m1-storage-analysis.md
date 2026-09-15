# jero-pi P2 milestone-1 (authority STORAGE) — storage-layer design analysis

> 由分析子代理产出（2026-09-15），供实现子代理作为规格使用。
> 所有 gentle-pi-main 路径在 `D:\jero-pi\gentle-pi-main\` 下；jero-pi 路径在 `D:\jero-pi\jero-pi\` 下。
> 除特别说明，jero-pi `lib/` 移植件与 gentle-pi-main 逐字节一致（已 diff 验证：review-object-store、review-lock、review-snapshot、review-repository、review-canonical、review-candidate-view、review-integration-v2、review-compact-contract、review-correction-lifecycle、review-graph-schema = 0 差异行），故 gentle-pi-main 行号在 jero-pi 同样有效。
> 两个例外：`jero-pi/lib/review-transaction.ts:1109-1111`（删除了 assertNoLegacyReviewAuthorityV1 调用，留注释 "foreign-authority-store refusal lands in lib/authority storage at P2"）；`jero-pi/lib/native-review-cli.ts`（1880 行 vs 2619 行；`NativeReviewCliV216` 在 jero-pi:1837-1850 对每个操作返回 `authority-unavailable ... refused fail-closed`）。`lib/authority/` 尚不存在。

## A. Authority store 磁盘布局（按证据）

上游有两套 authority store——Go 二进制的 compact store 与 TS 侧的 graph-v1 store。jero-pi 用 `.git/jero-review/` 取代两者并砍掉 graph-v1（设计文档 `D:\jero-pi\JERO-PI-DESIGN.md:121-133, 152-158`）。

### A.1 Go compact store: `<git-common-dir>/gentle-ai/review-transactions/v2/`

根路径证据：`tests/fixtures/native-review-cli/v2.1.3/finalize.json:7`（`receipt_path: ".../.git/gentle-ai/review-transactions/v2/lineage-1/review-receipt.json"`）；`tests/fixtures/devbinary/result-artifact-v2-path.captured.json:4`（`.../review-transactions/v2/review-ceeb2b862bd39709/reviewer-results/00-review-reliability.json`）。

```
<git-common-dir>/gentle-ai/review-transactions/v2/
├── LOCK                                  # store 级锁；entry version "compact-v2"
│                                         # (native-review-cli.ts:645 注释; tests/review-controller-lock-status.test.ts:61-63)
└── <lineage-id>/                         # 如 "lineage-1", "review-558624bfd9e14204"
    ├── review-state.json                 # 血统状态记录 (gentle-ai.review-transaction/v1, 见 C 节)
    ├── review-receipt.json               # 终态回执, FINALIZE 写入 (finalize.json:7)
    └── reviewer-results/<NN>-<lens>.json # 已准入审查工件 (result-artifact-v2-path.captured.json:4)
```

注意：gentle-ai 2.1.8 在普通成功操作后遗留 `LOCK`，STATUS 将其盘存为 `released`（死属主）条目——保持封闭枚举，未知锁状态 fail-closed（`lib/native-review-cli.ts:642-652`；`tests/review-controller-lock-status.test.ts:11, 61-63`）。

SDD 绑定工件 `gentle-ai.sdd-review-binding/v1`（`tests/fixtures/native-review-cli/v2.1.3/bind-sdd.json:1-25`），字段：`schema`、`revision` (sha256:)、`change`、`lineage`、`authority_revision` (sha256:)、`receipt_hash` (sha256:)、`gate_context`。

### A.2 TS graph-v1 store: `<git-common-dir>/gentle-ai/reviews/`

根解析：`lib/review-repository.ts:261`（`join(commonDirectory, "gentle-ai", "reviews")`，经 `git rev-parse --path-format=absolute --git-common-dir`，symlink 拒绝路径行走 :93-109）。已发布布局（代码证据）：

```
<git-common-dir>/gentle-ai/reviews/
├── IDENTITY                              # 钉住的仓库身份 (review-repository.ts:124-127, 195-237)
├── control/                              # review-transaction.ts:1102 把 join(store_root,"control") 传给锁;
│   ├── authority.lock/                   #   control-basename 规则 (review-lock.ts:131) 保持 control/authority.lock
│   │   └── owner.json
│   ├── authority.lock-intents/<token>.json   (review-lock.ts:141-144)
│   ├── quarantine/stale-<owner_hash>-<token>/, incomplete-<owner_hash>-<token>/  (review-lock.ts:191-212)
│   └── reset-state.json                  # (review-legacy-detector.ts:61-63)
├── graph-v1/
│   ├── STORE                             # gentle-ai.review-store/v1 描述符 (review-object-store.ts:105-122)
│   ├── CURRENT.0 / CURRENT.1 / CURRENT.2 # 2-of-3 quorum 指针, gentle-ai.review-current/v1 (:209-219)
│   ├── objects/events/sha256/<2-hex>/<62-hex>   # 事件 CAS (:57, :188)
│   └── roots/sha256/<2-hex>/<62-hex>           # 根集 CAS (:57, :189)
├── snapshots/<snapshot-sha256>/          # review-snapshot.ts:186-193, :417-456
│   ├── snapshot.json                     # gentle-ai.review-snapshot/v1 (2 空格 JSON + "\n", mode 0o600, :447-450)
│   └── objects/                          # 隔离 git 对象库 (mode 0o700)
└── lineages/<lineage>/  (legacy)         # HEAD + revision 文件
```

`openspec/changes/bounded-review-graph-parity/design.md:289-318` 记录的是更全的**提案**树（graph-v1/incarnations/、AUTHORITY.0-2、staging/imports/、operations/、cache/、mirrors/）——非已发布代码，勿当作已实现。legacy 根名识别：`lineages`、`locks`、`legacy-evidence`、`migration`、`migration-operations`（`lib/review-legacy-detector.ts:28`）。

### A.3 v1 vs v2 区分（勿混淆）

1. **Store 代际**：`"legacy-v1"` vs `"compact-v2"`（`NATIVE_REVIEW_AUTHORITY_ENTRY_VERSION`, native-review-cli.ts:628-632）——Pi 内部 authority-state 词汇。"compact-v2" 与 wire 契约 v2 无关（`docs/native-authority-architecture.md:21-23`）。
2. **Wire 契约**：`gentle-ai.review-integration/v1`（Base64 `candidate_diff` 传输；信封 start/v2）vs `/v2`（不可变 `base_tree`/`candidate_tree` + 有序 `changed_path_manifest` + 强制 `artifact_subjects`；信封 start/v3, status/v5, consent/v3, failure/v2）——`docs/native-authority-architecture.md:25-34`、`docs/readme-reference.md:255`。信封代际：plain start（无 schema, v2.1.3 fixture）、start/v2、start/v3、start/v4 续跑（2.5.0+）、status/v2..v7、consent/v2→v3——见 NATIVE_CLI_CONTRACTS 行, native-review-cli.ts:861-1005。

### A.4 关键信封 schema 与精确字段名（黄金向量来源）

**start/v3**（`tests/fixtures/review-integration/v2/fixtures/start.fixture.json`、`tests/fixtures/devbinary/start-v3-consent-granted.captured.json`；解码器 `lib/review-integration-v2.ts:331-352`）：`schema` "gentle-ai.review-integration.start/v3", `contract`, `operation` "review.start", `action` (created|resumed|replayed|closed|blocked-scope-action), `lenses_required`, `lineage_id`, `state` (ReviewStartState), `risk_level` (low|medium|high), `selected_lenses[]` (review-risk|review-resilience|review-readability|review-reliability), `projection` (workspace|staged), `base_tree`, `candidate_tree`, `changed_files`, `changed_lines`, `correction_budget`, `risk_reasons[]` {code, signal?, path?, old_mode?, new_mode?}, `artifact_subjects[]`, `changed_path_manifest[]` {path, status A|D|M|T, old_mode, new_mode, deleted, type_changed, mode_only, intended_untracked}, `repository_context` {capability "review.opaque_repository_context", handle "rctx1_<64hex>", revision sha256:, target_identity sha256:, event_id? sha256:, outcome? applied|pending|blocked_conflict|durability_limited}。

**artifact-subject/v2**（start.fixture.json:26-37；`review-integration-v2.ts:299-311`）：`schema` "gentle-ai.review-artifact-subject/v2", `subject_hash` sha256:, `lineage_id`, `authority_revision` sha256:, `target_identity` sha256:, `base_tree`, `candidate_tree`, `changed_path_manifest_sha256` sha256:, `lens`, `selected_order`, 可选 `correction_target_identity`。

**status/v5**（`tests/fixtures/devbinary/status-v5.captured.json`；`ReviewStatusV3` review-integration-v2.ts:612-645）：`schema` "gentle-ai.review-integration.status/v5", `contract`, `operation` "review.status", `applicability` (current_target|unrelated|ambiguous|corrupted; 枚举 :11-18), `authority` {version compact-v2|legacy-v1, lineage_id, state, generation, revision sha256:}, `receipt` {status expected_missing|present|publication_pending|not_applicable, identity?}, `action` (start|recover|maintainer_action|select_lineage|repair_authority|stop|collect|execute; :85), `action_disposition?` (scope_changed|invalidated|escalated), `replayability` (not_replayable|exact_replay_safe|status_required|manual_action_required; :20-26), `frozen` {tier, original_changed_lines, correction_budget, changed_path_manifest_sha256?}, `reconciliation?` {required: true}, `target_identity`, `projection` (gentle-ai.review-integration.projection/v1: schema, kind current-changes|base-diff|base-workspace-overlay|exact-revision|fix-diff, projection, base_tree, initial_review_tree, current_candidate_tree, paths_digest, paths[], intended_untracked[], intended_untracked_proof, initial_snapshot_identity, current_snapshot_identity), `repair` {schema gentle-ai.review-authority-repair-assessment/v1, status, counts{...}, supported_operations[], authorization_schema}, `candidates[]`, `forecast?` {horizon, steps[]}, `next_transition` {kind execute|collect|stop, reason_code, execute?{...}, collect?{inputs[]}, correctionRequest?, continuation?, unachievableLensSlots?}, `repository_context?`, `validation_request?`, `eligible_untracked_inventory?`。

**consent/v3**（`tests/fixtures/devbinary/consent-v3.captured.json`）：`schema`, `contract`, `operation`, `action` "consent_required", `agent` (claude-code|pi; :678-684), `blocking` true, `target_identity`, `projection`, `risk_level`, `changed_files`, `changed_lines`, `headline`, `reason`, `value`, `risk_evidence[]`, `choices[]` {answer granted|declined, label, effect, invocation}, `off_path` {note, command}。

**failure/v2**（`tests/fixtures/devbinary/failure-v2-capture-evidence.captured.json`；review-integration-v2.ts:746-768, 枚举 :28-33, :88-93）：`schema` gentle-ai.review-integration.failure/v2, `contract`, `operation`, `phase`, `code`, `message`, `mutation_outcome` (not_started|unknown|committed), `authority_applicability`, `retry_safe`, `replayability`, `lineage_id`, `required_inputs[]`, `next_action` (review.status), `cause`。

**last-event-closure/v1**（devbinary/last-event-capture-*.captured.json）：`schema` gentle-ai.review-last-event-closure/v1, `operation` (review/capture-result | review.capture-correction-plan | review.capture-refuter | review/capture-validation), `lineage_id`, 可选 `target_identity`/`request_hash`/`correction_lines`, `state`, `action`, 可选 `status_continuation` {operation, arguments[], preconditions[], binding{lineage_id, revision, target_identity}}, 可选 `advisory_findings` {statement, findings[{id, lens, location, severity, disposition}]}, `store_revision` sha256:。

**result-artifact/v2**（devbinary/result-artifact-v2.captured.json）：`schema` gentle-ai.review-result-artifact/v2, `capability` "review.native_result_artifact", `reference` "rart1_<64hex>", `sha256`, `lineage_id`, `target_identity`, `lens`, `selected_order`, `subject_hash`, `admission_decision`, 可选 `path`。

**review-acknowledged/v1**（devbinary/review-acknowledged-v1.captured.json）：`schema`, `operation` "review/acknowledge-approved", `action` "acknowledged", `lineage_id`, `target_identity`, `consumed_revision`, `authority` "burned"。

**Gate-result/v1 + gate-context**（validate-allow/deny.json）：`schema` gentle-ai.review-gate-result/v1, `result` (allow|scope-changed|invalidated|...), `allowed`, `action` (continue|create-new-lineage|explicit-maintainer-action), `reason`, `context` = gate-context: 必需 `gate, lineage_id, generation, base_tree, candidate_tree, paths_digest, fix_delta_hash, policy_hash, ledger_hash, evidence_hash, base_relationship_valid`；可选 `store_revision, genesis_revision, chain_identity, bundle_digest, external_evidence, base_advanced_compatible, release, pre_pr_boundary, denial{stage, code}`（解码器 native-review-cli.ts:1197-1234；NATIVE_GATE = post-apply|pre-commit|pre-push|pre-pr|release, review-integration-v2.ts:104）。

**Plain authority status 盘存**（native-review-cli.ts:615-720, 解码器 :1319-1336）：schema `gentle-ai.review-authority-status/v1`, operation "review/status", `repository`, `complete`, `authoritative`, `status` (clean|active|approved|escalated|reset-in-progress|superseded|recovered|same-lineage-mixed-collision|invalid), `entries[]`, `locks[]`, `diagnostics[]`。Entry: `version` (legacy-v1|compact-v2), `lineage_id?`, `path`, `status` (+incomplete-store-entry|historical-pre-receipt|invalidated), `state?`, `revision?`, `snapshot_identity?`, `chain_identity?`, `recovery?` {predecessor_lineage_id, predecessor_revision, disposition, reason, actor, recovered_at, maintainer_authorization?}, `discarded_work?` {captured_lens_results[], findings_present}, `problems[]`。Lock: `version`, `lineage_id?`, `path`, `status` (owned|ambiguous|released), `owner?` {schema gentle-ai.review-store-lock/v1, owner_id, pid, host, acquired_at}, `problem?`。Diagnostic: {path, problem}。

## B. 已移植 jero-pi 模块：精确 API + `.git/jero-review/` 的缺口

**review-canonical.ts** — `canonicalJsonV1(value)`, `canonicalBytesV1(value)`, `sha256Hex(bytes)`, `domainHashV1(domain, value)` = sha256 of `gentle-ai.review-<domain>/v1\0<canonicalJSON>` (:43-46), `parseCanonicalJsonV1(input, maxBytes=1MiB)`（拒绝非规范重序列化, :48-63）, `ReviewCanonicalError`。

**review-repository.ts** — `resolveRepositoryAuthorityV1(cwd): RepositoryAuthorityV1 {common_directory, store_root, repository_identity, repository_id, authority_id}` (:270-298)；`resolveRepositoryAuthorityForRecoveryV1(cwd)` 宽松变体；`writePinnedRepositoryIdentityV1(storeRoot, identity)`；`reviewStoreRootForRepositoryV1(cwd)`；`reviewGitEnvironment()` / `publicationProbeGitEnvironment()` / `inheritedUnsafeGitEnvironmentKeys(env)` (GIT_* 拒绝集 :30-73)；`assertManagedStorePathV1(commonDir, path)` (:93-109)；`IDENTITY_FILENAME`。Identity body `{schema: "gentle-ai.review-repository/v1", object_format, root_commit_ids[]}`；`repository_id = domainHashV1("repository", identity)`，`authority_id = domainHashV1("authority", {repository_id, graph_format: "graph-v1"})` (:290-297)。IDENTITY 首写：wx temp + fsync + link + EEXIST-read-back (:195-237)。行为契约：tests/review-repository.test.ts（身份一次钉住 :112；孤儿根子集容忍 :121；移植 fail-closed :138；历史重写子集违规 :162；竞争恢复 :173）。

**review-object-store.ts** — `ReviewGraphObjectStoreV1.forRepository(cwd, opts)`（根 `<store>/graph-v1`, :47-50）；`installEvent`, `installCanonicalEventBytes`, `readEvent`, `installRootSet(body)`, `publishRootSet(root)`, `readCurrent()`, `readStoreDescriptor()`, `initializeDestructiveReset(...)`, `repairCurrentPointers()`；故障点 `before-object-fsync | before-object-install | before-current-slot-{0,1,2}-replace` (:38)。CAS 纪律 `installImmutable` (:190-205)：mkdir 0o700 → 存在? 字节相等幂等 / 冲突抛错 → temp `${path}.${pid}.${rand}.tmp` wx 0o600 → fsync 文件 → link → fsync 目录（win32 跳过目录 fsync :221）。指针：规范 JSON CURRENT.{0,1,2}，`pointer_hash = domainHashV1("current", body)`，temp wx + fsync + rename (:209-218)；quorum = 2-of-3 (:182-187)。契约：tests/review-object-store.test.ts（幂等/冲突 :37；quorum 必需 :50；故障保旧权威 :63；创世前向恢复 :87-135；前驱纪律 :137）。

**review-lock.ts** — `ReviewMutationLockV1(controlRoot, repositoryId, authorityId, platform?)`；锁路径规则：`basename(controlRoot) === "control" ? controlRoot : controlRoot/locks` + `/authority.lock` (:130-132)。方法 `acquire()`, `release(owner)`, `inspect()`, `recover(expectedOwnerHash)`, `recoverIncomplete(expectedToken)`。Owner `{token(64hex), owner_hash, pid, repository_id, authority_id}`，`owner_hash = domainHashV1("lock-owner", unsigned)` (:139-140)。`conservativeOwnerDeathProofV1` (:32-40)：pid 安全正数、非自身、`process.kill(pid,0)` 恰以 ESRCH 失败。`qualifiedNodeFsLockPlatformV1()` (:68-115)：files = link+unlink；win32 dirs = rename；POSIX dirs = mkdir 0o700 + rename + 回滚 rm。契约：tests/review-lock.test.ts（token 围栏释放 :25；active/ambiguous fail-closed :39；隔离区 `stale-<owner_hash>-<token>` 持久 :51-63；占用目标 no-replace :106-170；不完整获取仅在死属主+有效意图时可恢复 :172）。

**review-snapshot.ts** — `captureReviewSnapshot({cwd, mode, projection, policyHash}): SnapshotV1`；`captureLiveReviewCandidateBinding({cwd, repositoryId})`；`cleanupReviewSnapshot(snapshot)`；`discoverReviewUntrackedPaths(cwd)`；`deriveReviewSnapshotRisk(snapshot)`。`SnapshotV1` 字段 (:85-103)：schema gentle-ai.review-snapshot/v1, mode (ordinary|judgment-day), repository_root, base_tree, complete_snapshot_tree, review_projection, initial_review_tree, genesis_paths?, intended_untracked[], diff_evidence, route, lenses[], risk_tier, original_changed_lines, correction_budget, policy_hash, object_store {...}。身份 = 对同字段减 object_store 的 sha256(JSON.stringify) (:127-144, 257)。落盘：mkdtemp `<snapshots>/.capture-*` 0o700 → snapshot.json → 存在则校验一致返回 : 删 staging → rename (:337-456)。契约：tests/review-snapshot.test.ts（不动 index/worktree :90；隔离对象库扛过 `git gc --prune=now` :254；testdata/golden 计入身份不计入风险行 :211；预算 min(200, ceil(lines/2))）。

**review-transaction.ts**（graph-v1 机器；大部分不复用，但其请求日志/回执模型是目标模型）— `ReviewTransactionStore.forRepository(cwd, opts)` (:1102)；`canonicalHash(value)` (:475)；`createFrozenLedger`, `assertFrozenLedgerIntegrity`, `createReviewState`, `createReceiptEnvelope(body)`, `assertReceiptIntegrity(envelope)`, `validateReviewGraphReplayV1`, `evaluateGateTarget`, `validateReviewGate`。类型：`ReviewStateV1` (:259-289, gentle-ai.review-state/v1: lineage_id, parent_lineage_id?, mode, revision(int), phase(started|discovery-complete|refutation-complete|fix-complete|validation-complete|final-verification|judgment-complete|terminal), base_tree, complete_snapshot_tree, review_projection, initial_review_tree, genesis_paths?, snapshot_object_store?, current_candidate_tree, final_candidate_tree?, route, lenses[], policy_hash, frozen_ledger? {...}, evidence_hash, budget/counters {...}, resolutions?, fix_record?, validation_evidence?, active_finding_ids?, escalation_reasons?, child_claims?, request_journal[], terminal_state?)；`RequestJournalEntryV1` (:213-220)：{operation(start|freeze-ledger|resolve-evidence|authorize-fix|validate-fix|verify|gate), idempotency_key, request_hash, status(pending|completed), authorization?, canonical_result?}；`ReceiptBodyV1` (:300-317)；`ReceiptEnvelopeV1 {body, receipt_hash}`。日志语义证明：tests/review-transaction.test.ts:209-344（跨重启精确重放返回存储结果；同 key 不同 request_hash 抛错；pending 阻塞新操作；发布故障保旧修订）。

**review-candidate-view.ts** — 审查员侧不可变候选视图（chmod 只读 worktree 限定到 manifest）：`CandidateViewRegistry`, `createCandidateView`, `deriveChangedPathManifest`, `digestChangedPathManifest`, `resolveCanonicalCandidateBase` 等（导出于 :343-1866）。按设计原样复用。

**`.git/jero-review/` authority store 的缺口**：
1. **Store 根硬编码 `gentle-ai/reviews`**：review-repository.ts:261 与 review-snapshot.ts:186-193。jero-review 需要自己的根解析器（`<common-dir>/jero-review`）与快照根；review-repository 的 git-env/probe/identity 机器可复用，路径常量不可。
2. **foreign-authority-store 检测是新的**：review-legacy-detector.ts 是结构先例（固定根名探针、no-follow lstat、版本歧义图）但检测的是 legacy Pi store，不是上游 `.git/gentle-ai` 数据。jero-pi review-transaction.ts:1109 已删调用点等待此件。
3. **无通用 typed-object CAS**：installCanonicalEventBytes 只验证 ReviewEventEnvelopeV1 且路径是 objects/events/...；新的 `objects/<sha256>`（对规范字节的纯内容哈希、任意 typed record、schema 字符串校验、unknown-key 严格）不存在。installImmutable (:190-205) 是要抽取的纪律。
4. **domainHashV1 命名空间**：所有身份域嵌 `gentle-ai.review-*` 前缀 (review-canonical.ts:45)。jero.authority/v1 需要自己的域字符串；保持移植模块不动，在 canonicalJsonV1/sha256Hex 之上叠新域。
5. **CURRENT/roots quorum 机器是 graph-v1 专属**——按设计 §5.1.6 砍掉；持久化模型改为 compact 式血统记录（state 文件 + revision + LOCK）。
6. **严格解码器是私有的**：`exactObject`/`requiredString`/... 在 native-review-cli.ts:1065-1086 与 review-integration-v2.ts 内部；protocol.ts 必须拥有它们。
7. **环境变量读取**：native-review-cli.ts:39-51 读 GENTLE_PI_REVIEW_MAX_BUFFER_BYTES 等；lib/authority 必须一个都不读（设计 §7 line 321）。

## C. 血统状态记录——字段级规格（二进制持久化/返回的内容）

**磁盘事务记录** `gentle-ai.review-transaction/v1`（严格解码器 lib/native-review-cli.ts:1393-1435——权威字段表；磁盘路径 `<store>/<lineage>/review-state.json`）：
必需：`schema`, `lineage_id`, `mode` (ordinary_4r|ordinary_bounded|judgment_day), `generation` (非负 int), `state` (unreviewed|reviewing|judges_confirmed|findings_frozen|evidence_classified|fix_required|fixing|fix_validating|ready_final_verification|final_verifying|approved|escalated|invalidated — :1401), `snapshot` {kind current-changes|base-diff|commit-range|fix-diff, base_tree, candidate_tree, paths_digest, intended_untracked[], intended_untracked_proof, paths[], identity, ledger_ids?[]} (:1361-1367), `base_tree`, `paths_digest`, `initial_review_tree`, `final_candidate_tree`, `fix_delta_hash`, `policy_hash`, `ledger_hash`, `ledger_findings_hash`, `evidence_hash`, `judge_proofs[]` {judge_id, execution_hash, result_hash, blind, confirmed} (:1406-1410), `counters` {full_reviews, refuter_batches, fix_batches, scoped_fix_validations, final_verifications, fix_rounds, scoped_rejudgments, judge_runs; 可选 risk_executions, resilience_executions, readability_executions, reliability_executions} (:1411-1412), `findings[]`, `classifications` (map finding_id → {finding_id, class deterministic|inferential|insufficient, proof, causal_disposition? introduced|behavior-activated|worsened|pre-existing|base-only|unknown} :1384-1388), `outcomes` (map finding_id → corroborated|refuted|inconclusive|info :1419-1420), `fix_finding_ids[]`, `pending_refuter_ids[]`, `fix_caused_findings[]`, `follow_ups[]` {observation, proof_refs[]}。
可选：`genesis_paths[]`, `invalidation_reason`, `judge_proof_hash`, `judge_agreement_hash`, `failed_evidence_revision`, `original_criteria` {evidence_hash, fix_delta_hash, passed}, `correction_regression`（同）, `release` {...} (:1186-1190), `risk_level` (low|medium|high), `selected_lenses[]`, `lens_results[]` {lens, findings[], evidence[], result_hash} (:1377-1383), `original_changed_lines`, `correction_budget`, `proposed_correction_lines`, `actual_correction_lines`。
Finding row (:1368-1376)：必需 `id`；可选 `lens` (risk|resilience|readability|reliability——注意 lens-result 的 lens 名是 review-risk 等，finding 的 lens 名是裸名), `location`, `severity` (BLOCKER|CRITICAL|WARNING|SUGGESTION), `claim`, `proof_refs[]`。

**身份链**：每次变更推进 `revision`（`sha256:<64hex>`）；调用方须呈交匹配当前值的 `--expected-revision`。START 冻结：lineage_id (`review-<16hex>`), target_identity, 每 lens subject_hash, changed_path_manifest_sha256, intended_untracked_proof（仅对未跟踪路径**名**的摘要——readme-reference.md:283）。纠正计划携带 request_hash + correction_lines (1..200, native-review-cli.ts:2451)。

**幂等键/请求哈希**（TS graph 模型，要移植的语义）：RequestJournalEntryV1 持久化在 state 内部；(key, request_hash) 精确重放返回存储的 canonical_result；key 复用+不同请求 fail-closed；pending 条目阻塞新操作且可跨崩溃补全（review-transaction.ts:213-220; tests/review-transaction.test.ts:209-318）。wire 级等价物：failure/v2 的 `retry_safe`/`replayability`/`mutation_outcome`；"未知或丢失的变更结果之后，先 target status 再决定重放"（readme-reference.md:257）。

**约束状态的状态集**（readme-reference.md:234-249, 301, 311-319）：compact 普通五态 `reviewing → correction_required → validating → approved | escalated`；纠正恰一次，预算 `min(200, ceil(original_changed_lines/2))`；仅 severe（introduced/behavior-activated/worsened 且有效 proof）进纠正 ID；pre-existing/base-only → follow-ups；unknown/insufficient/malformed/inconclusive 的 severe → escalated；透镜永不重跑；冻结发现与创世范围不可变；JD 仅显式，两盲审、零反驳者、≤2 轮 discovery/re-judgment、round2 存活发现 → escalated。FINALIZE 包装输入（readme-reference.md:261-279; lib/review-compact-contract.ts:132-167）：`review_result.lens_results[]`, `final_evidence` 与 `final_verification_passed`|`final_verification_outcome` 二选一配对, `correction_line_forecast` 正 int, `validation` {request_hash, correction_ids[], original_criteria, correction_regression, fix_caused_findings (必须 []), follow_ups[]}, `reviewer_run_acknowledged`。

## D. 锁语义

**Go compact LOCK**：owner 信封 `gentle-ai.review-store-lock/v1` {schema, owner_id, pid, host, acquired_at}；STATUS 报 owned|ambiguous|released；released = 成功操作后的死属主遗留（2.1.8 行为, issue #184）不阻塞新 START；封闭枚举——未知状态 fail-closed。

**TS ReviewMutationLockV1**（jero-review/locks/ 采用的语义）：
- 锁 = 目录 `<control>/locks/authority.lock/` 含 `owner.json`（规范 JSON, 0o600）。
- 获取：(1) 写持久意图 `authority.lock-intents/<token>.json`（wx+fsync 文件+目录）；(2) `mkdir lock-path`——EEXIST → fail-closed "active or ambiguous"，绝不抢；(3) 写 owner.json wx + fsync 文件 + fsync 锁目录 + fsync 父目录 + unlink 意图。mkdir 后失败：不完整目录**刻意保留**（抢它有歧义）；仅 `recoverIncomplete(token)` 可恢复——要求有效匹配意图 AND proveOwnerDead。
- 释放：校验观察到的 owner 匹配调用方 token/hash/pid/repo/authority，然后 no-replace 移动到 `released-<owner_hash>-<token>` + rm（墓碑痕迹），非合格平台直接 rm。
- 恢复 stale：校验 owner_hash、proveOwnerDead、no-replace 移动到 `quarantine/stale-...`（持久, token 围栏）；任何竞争 → "re-observe" 错误。
- inspect(): absent|owned|ambiguous（owner.json 不可读 = ambiguous, fail-closed）。
- 平台：qualifiedNodeFsLockPlatformV1；fsync 全覆盖，win32 跳目录 fsync。

## E. 建议 `lib/authority/` 存储里程碑分解

纪律：SHA-256 仅经 node:crypto；temp+rename/link 原子写；不读环境变量；typed 判别联合 API（无自由文本参数）；unknown-key 严格解码；foreign-authority-store 检测 → status 报 `foreign-authority-store` 并拒 START（§5.1.6 line 158）。

1. **`lib/authority/store-root.ts`** — 解析 `<git-common-dir>/jero-review/`，复用 review-repository.ts 的 reviewGitEnvironment()/probe/symlink 拒绝（重定向 :261 的常量）。拥有 jero 身份钉住（IDENTITY 文件，writePinnedRepositoryIdentityV1 纪律）与 **foreign-store 检测**：探针固定上游名——`gentle-ai/reviews`（IDENTITY, graph-v1, control, snapshots, lineages, locks）、`gentle-ai/review-transactions`（v2 目录含 LOCK）——仅 no-follow lstat 探针（review-legacy-detector.ts:31-44 模式）；任何命中 → 判别联合 `{kind:"foreign-authority-store", ...}` 并拒 START。
2. **`lib/authority/protocol.ts`** — 内部信封 schema（`jero.authority/v1` 族；verify-result → `jero.verify-result/v1`）：state/snapshot/artifact-subject/gate-context/receipt/failure/closure 的 typed record + 导出严格解码器（exact-key-set 校验；从 native-review-cli.ts:1065-1086 抽取 `exactObject` 纪律为私有 decode-strict 助手）。conformance 目标：A.4 列出的 vendored fixtures。
3. **`lib/authority/object-cas.ts`** — `objects/<sha256>` 内容寻址库：put(record) = canonicalJsonV1 → sha256Hex → temp wx 0o600 + fsync + link + 目录 fsync，字节相等幂等，冲突字节抛错（纪律逐字取自 review-object-store.ts:190-205）；get/摘要校验用 parseCanonicalJsonV1 + 每类型 schema 字符串 + unknown-key 检查。
4. **`lib/authority/lineage-store.ts`** — `lineages/<lineage>/` 状态记录：当前记录文件经 temp+rename 写入（orchestrator-presence.ts:146-158 `atomicWrite` 是库内模式：O_EXCL 0o600 temp, write, rename, finally unlink-tmp）；内嵌请求日志（RequestJournalEntryV1 语义）；expected-revision 乐观并发（每次变更 `sha256:` revision，不匹配 → stale fail-closed）；一切变更持锁；终态后再变更与同血统歧义 fail-closed。字段模型：C 节。
5. **`lib/authority/locks.ts`** — 构造 `ReviewMutationLockV1(jeroReviewRoot, jeroRepositoryId, jeroAuthorityId)` 的薄包装（锁落在 `jero-review/locks/authority.lock`——注意锁路径规则会把传入根当 control 根，需要包一层 control 目录或适配），暴露 acquire/withLock(release-always)/inspect/recover + compact 式状态词汇（owned|ambiguous|released）。包装 review-lock.ts 不改。
6. **`lib/authority/snapshots.ts`** — START 候选冻结：快照根重定向到 `jero-review/snapshots/`（review-snapshot.ts:186-191 常量），复用 captureReviewSnapshot/captureLiveReviewCandidateBinding/cleanupReviewSnapshot 与 SnapshotV1 形状；纠正预算与风险沿用 review-risk.ts。
7. **`lib/authority/receipts.ts`** — 回执信封 create/verify 移植自 review-transaction.ts:895-933（canonicalHash body, 完整性断言），FINALIZE 时持久化到 CAS + `lineages/<id>/review-receipt.json`；consumed/burned 语义。
8. **`tests/authority/conformance/`** — 黄金向量：复制 `contracts/review-integration/v1+v2/fixtures/**`、`tests/fixtures/native-review-cli/v2.1.3/*.json`、`tests/fixtures/devbinary/*.captured.json` 的**语义**（非字节），断言字段级同构（不含时间戳）；unknown-key 拒绝作内部不变量测试（设计 §5.1.7:160-166）。

里程碑 1 范围 = 项 1-5（+7 最小）配存储形状 conformance 种子；渲染/SDD/维护在后续子里程碑（设计 line 340：存储→状态机→渲染→SDD→维护→conformance 收尾）。

**实现代理注意事项**： 绝不用 `domainHashV1` 做 jero 身份（输出内嵌 `gentle-ai.review-`，review-canonical.ts:45）——在 canonicalJsonV1/sha256Hex 上定义新 jero 域字符串； review-snapshot.ts/review-repository.ts 需要根重定向缝（当前硬编码 `gentle-ai/reviews`）——优先加参数/选项而非原地改移植件，保持 conformance diff 干净； openspec bounded-review-graph-parity 的布局树是未实现提案，已发布证据只有 STORE/CURRENT/objects/roots； LOCK 遗留即 released 的行为必须在状态词汇中保留，否则新 START 会在崩溃后卡死。
