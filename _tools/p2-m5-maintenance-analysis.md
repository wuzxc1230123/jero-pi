# P2-M5 权威规格：authority.maintenance.*（主会话重锚版 2026-09-16）

> 源锚：GP lib/native-review-cli.ts:56-60,103-108,310-401,1579-1790；docs/readme-reference.md:182-196；M2 start.ts:338-347（锁门）；M1 分析 entry.recovery 字段。
> §5.1.6 裁定：保留 abandon + reconcile-authority；**不移植** quarantine-legacy / repair-legacy-alias（无历史血统）；reclaim 对应上游 RESET/RECOVER_LOCK 的 native 落点。

## 语义（readme:182-196）

- 破坏性转移一律"显式授权绑定 + 新鲜交互批准（扩展层 P4 负责）+ headless fail-closed（授权串缺省即拒）"
- abandon：精确**八行**绑定（schema gentle-ai.review-abandon-authorization/v2 + lineage/revision/snapshot_identity/reason/captured_lens_results/findings_present/actor——GP:1710-1724 逐字）；权威侧**重推导**非终态资格与丢弃工作（不符即拒）；效果 = 血统转 invalidated + 隔离记录
- recover：前驱+后继+disposition ∈ {scope_changed, invalidated, escalated}（GP:310）+可选 maintainerAuthorization（非空 LF-only，GP:1603-1605）；效果 = 后继写 recovery 元数据 {predecessor_lineage_id, predecessor_revision, disposition, reason, actor, recovered_at, maintainer_authorization?}（M1 分析 entry.recovery 形状）
- reconcile-authority：精确**七行**绑定 + 可选 anomalies=unchanged_target,malformed_recovery_authorization 后缀（GP:1766-1777）；**窄语义**：仅隔离所绑定的无效 compact-v2 恢复后继；前驱不动；持久审计记录；恢复不授新预算
- reclaim（= 上游 RESET/RECOVER_LOCK 落点）：仓库绑定破坏性恢复——权威侧效果 = 血统目录整体隔离（quarantine-not-delete）+ 店级维护日志

## M5 模块设计

lib/authority/maintenance.ts 单模块 + protocol.ts 追加 JERO_AUTHORITY_OPERATIONS 成员 "abandon"、"reconcile-authority"（审核式封闭枚举追加；reclaim/recover 走店级日志不入血统日志）：

1. `abandonJeroLineageV1(context, input)`：校验八行绑定 === jeroAbandonAuthorizationV1(input)（推导函数逐字移植，schema 串保留 gentle-ai 前缀至 P5）；load 血统（missing/corrupted → 类型化拒绝）；非终态校验（approved/escalated/invalidated → not-abandonable）；**重推导**：capturedLensResults 必须等于 record.lens_results 的 lens 名列表、findingsPresent === (findings.length > 0)、snapshotIdentity === record.state.snapshot.identity、expectedRevision === record.revision（不符 → discarded-work-mismatch）；锁下 journaled save（op "abandon"）：state → invalidated、invalidation_reason = reason；审计 sidecar lineages/<id>/maintenance.json 追加 {operation:"abandon", binding, actor, revision_before}
2. `reclaimJeroAuthorityV1(context, input)`：{lineage, actor, reason}；load 校验存在；锁下把 lineages/<id>/ 整目录 rename 到 lineages/.quarantine-<id>-<uuid>/；店级 <store>/maintenance-log.json 追加 {operation:"reclaim", lineage, actor, reason, at}；结果 {kind:"reclaimed", quarantineDirectory}
3. `recoverJeroLineageV1(context, input)`：前驱/后继 load；expectedPredecessorRevision 匹配前驱当前 revision；disposition 枚举；可选授权串 LF-only 校验；后继写 recovery 元数据（sidecar maintenance.json 记录 + 血统 record 经 plain save 附加？——不改 13 态，recovery 元数据落 sidecar，wire STATUS 后续从 sidecar 读）；前驱不动
4. `reconcileJeroAuthorityV1(context, input)`：七行绑定 === jeroReconcileAuthorizationV1(input)（含可选 anomalies 后缀）；前驱/后继 revision 双匹配；仅当 anomalies === 组合异常时隔离后继（quarantine 目录 + 日志）；否则后继标 recovery（同 recover 路径）；审计记录持久；前驱永不动
5. 店级维护日志：append-only JSON 数组，temp+rename 原子写，严格解码

## 测试

abandon（绑定不匹配/终态/丢弃工作不匹配/成功转 invalidated+maintenance.json）；reclaim（目录隔离存在、日志追加、再次 load → missing）；recover（revision 不匹配拒/disposition 枚举/成功写 recovery 元数据/前驱不动）；reconcile（七行绑定/双 revision/组合异常才隔离/前驱不动）；维护日志原子性与解码拒绝。
