import { jeroDomainHash } from "./canonical.ts";
import type { JeroAuthorityContextV1 } from "./review.ts";
import {
	JERO_REVIEW_TRANSACTION_SCHEMA,
} from "./canonical.ts";
import {
	JERO_LENS_NAMES,
	type JeroAuthorityCountersV1,
	type JeroAuthoritySnapshotV1,
	type JeroLensName,
	type JeroReviewMode,
	type JeroReviewTransactionStateV1,
	type JeroRiskLevel,
} from "./protocol.ts";
import type { JeroLineageStateFileV1 } from "./lineage-store.ts";
import { computeJeroLineageRevisionV1 } from "./lineage-store.ts";
import { isJeroLineageId } from "./store-root.ts";
import { captureJeroReviewSnapshotV1, jeroReviewPolicyHashV1, jeroUntrackedInventoryDigestV1, jeroPathsDigestV1, type JeroSnapshotDerivationV1 } from "./snapshots.ts";
import { projectJeroReviewStateV1, type JeroReplayability, type JeroWireReviewState } from "./transitions.ts";
import { effectiveJeroReviewModeV1 } from "./mode.ts";
import { issueJeroReviewReceiptV1 } from "./finalize.ts";
import { mintJeroRepositoryContextV1, type JeroRepositoryContextV1 } from "./repository-context.ts";
import { JERO_LINEAGE_STATE_SCHEMA } from "./canonical.ts";
import type { ReviewDiffStat } from "../review-risk.ts";
import { FULL_4R_LENSES } from "../review-triggers.ts";
import type { JeroSnapshotKind } from "./protocol.ts";

// `authority.review.start`（spec §B）：基于 jero 快照接缝的冻结计算、
// 经移植分类器的风险层级 → 评审视角、内容派生的血脉身份、产物主题、
// 外来存储拒绝、锁纪律，以及 START 同意门——全部汇成一个可辨识联合。

export type JeroReviewStartRefusalCode =
	| "not-a-git-repository" | "git-unavailable" | "authority-unavailable" | "foreign-authority-store"
	| "invalid-request" | "authority-lock-held" | "authority-lock-ambiguous" | "lineage-not-startable"
	| "identity-mismatch" | "lineage-consumed" | "snapshot-failed" | "corrupted";

export interface JeroReviewStartTargetV1 {
	readonly cwd: string;
	/** 要求 `committedOnly: true`（保守失败配对，spec §B.1）。 */
	readonly baseRef?: string;
	readonly committedOnly?: boolean;
	readonly lineageId?: string;
	/** M3（§G）：`"staged"` 经临时索引从 Git INDEX 冻结候选——绝不用活动工作树，也绝不用真实索引。 */
	readonly projection?: "workspace" | "staged";
	/** 仅用于漂移检测：调用方期望的 `sha256:<64 位十六进制>`（spec §B.1）。 */
	readonly targetIdentity?: string;
	/** Judgment Day 仅在显式请求时启动（spec §G）。 */
	readonly requestMode?: "ordinary" | "judgment-day";
}

export interface JeroIntendedUntrackedSelectionV1 {
	readonly argumentTokens: readonly string[];
	readonly value: string;
}

export interface JeroReviewStartSelectionV1 {
	readonly untrackedScope?: "exclude" | "select";
	readonly expectedUntrackedInventory?: string;
	readonly intendedUntracked?: readonly string[];
	readonly intendedUntrackedSelection?: JeroIntendedUntrackedSelectionV1;
	/** §B.5 的同意答案；常设会话授权在 TS 侧，以 `standingGrant` 传入。 */
	readonly consent?: "granted" | "declined";
	readonly standingGrant?: boolean;
	readonly idempotencyKey?: string;
}

export interface JeroRiskReasonV1 {
	readonly code: string;
	readonly signal?: string;
	readonly path?: string;
	readonly old_mode?: string;
	readonly new_mode?: string;
}

export interface JeroArtifactSubjectV1 {
	readonly schema: "jero.authority.artifact-subject/v1";
	readonly subject_hash: string;
	readonly lineage_id: string;
	readonly authority_revision: string;
	readonly target_identity: string;
	readonly base_tree: string;
	readonly candidate_tree: string;
	readonly changed_path_manifest_sha256: string;
	readonly lens: JeroLensName;
	readonly selected_order: number;
}

interface JeroStartAuthorityFieldsV1 {
	readonly action: "created" | "resumed" | "replayed" | "closed";
	readonly lineage_id: string;
	readonly state: JeroWireReviewState;
	readonly risk_level: JeroRiskLevel;
	readonly selected_lenses: readonly JeroLensName[];
	readonly lenses_required: boolean;
	readonly changed_files: number;
	readonly changed_lines: number;
	readonly correction_budget: number;
	readonly risk_reasons: readonly JeroRiskReasonV1[];
	readonly artifact_subjects: readonly JeroArtifactSubjectV1[];
	readonly target_identity: string;
	readonly projection: "workspace" | "staged";
	readonly repository_context?: JeroRepositoryContextV1;
	readonly revision: string;
	readonly replayability: JeroReplayability;
	readonly mode: JeroReviewMode;
}

export type JeroReviewStartResultV1 =
	| { readonly kind: "refused"; readonly code: JeroReviewStartRefusalCode; readonly detail?: string }
	| { readonly kind: "blocked-scope-action"; readonly reason: string; readonly expected_untracked_inventory: string; readonly projection: "workspace" | "staged" }
	| { readonly kind: "consent_required"; readonly action: "consent_required"; readonly target_identity: string; readonly projection: "workspace" | "staged"; readonly risk_level: "medium" | "high"; readonly changed_files: number; readonly changed_lines: number; readonly risk_evidence: readonly string[] }
	| { readonly kind: "declined"; readonly action: "declined"; readonly consent: "declined_this_candidate"; readonly target_identity: string; readonly projection: "workspace" | "staged"; readonly risk_level: "medium" | "high"; readonly changed_files: number; readonly changed_lines: number; readonly lineage_id: ""; readonly state: ""; readonly lenses_required: false; readonly selected_lenses: readonly []; readonly lens_bindings: readonly []; readonly correction_budget: 0 }
	| ({ readonly kind: "created" } & JeroStartAuthorityFieldsV1)
	| ({ readonly kind: "resumed" } & JeroStartAuthorityFieldsV1)
	| ({ readonly kind: "replayed" } & JeroStartAuthorityFieldsV1)
	| ({ readonly kind: "closed" } & JeroStartAuthorityFieldsV1);

// 线上风险原因词汇（spec §B.3，差异 #6）：尽管上游短语映射认识 8 个
// 信号，也只发出 6 值信号集。代码列表是封闭的 11 值线上 schema 词汇
// （start.schema.json）；jero 的派生绝不发出 `service_token`/
// `shell_source`（仅上游代码）——它们留在列表中是为了让类型记录完整的
// 线上契约。
const RISK_REASON_CODES = ["configuration_change", "empty_content", "executable_change", "executable_mode", "hot_path", "large_change", "non_executable_only", "process_boundary", "process_scan_limit", "service_token", "shell_source"] as const;
export type JeroRiskReasonCode = (typeof RISK_REASON_CODES)[number];

const RISK_SIGNALS = ["auth", "update", "security", "payments", "permissions", "shell_process"] as const;
export type JeroRiskSignal = (typeof RISK_SIGNALS)[number];

const HIGH_RISK_TOKEN = /^(?:auth|authentication|authorization|update|updater|security|payments?|permissions?|shell|process|processes|secrets?|credentials?|tokens?)$/i;
const HIGH_RISK_PHRASE = /(?:data[-_/ ]?(?:exposure|loss)|privilege[-_/ ]?escalation)/i;
const CONFIGURATION_PATH = /(?:^|\/)(?:requirements(?:-[^/]*)?\.txt|cmakelists\.txt|package(?:-lock)?\.json|pnpm-lock\.yaml|yarn\.lock|tsconfig(?:\.[^/]*)?\.json|dockerfile|makefile|\.env(?:\.[^/]*)?|[^/]+\.(?:jsonc?|ya?ml|toml|ini|conf|config|lock))$/i;
const DOCUMENTATION_PATH = /(?:^|\/)(?:readme|changelog|contributing|license)(?:\.(?:md|mdx|rst|adoc|txt))?$|(?:^|\/)(?:docs?|documentation)\/.+\.(?:md|mdx|rst|adoc|txt)$/i;
const PROCESS_TOKEN = /^(?:shell|process|processes)$/i;

function pathTokens(path: string): string[] {
	return path.toLowerCase().split(/[\/._-]+/).filter(Boolean);
}

function signalForToken(token: string): JeroRiskSignal {
	switch (token) {
		case "auth": case "authentication": case "authorization": case "secrets": case "secret": case "credentials": case "credential": case "tokens": case "token": return "auth";
		case "update": case "updater": return "update";
		case "security": return "security";
		case "payments": case "payment": return "payments";
		case "permissions": case "permission": return "permissions";
		default: return "shell_process";
	}
}

/** 冻结 diff 上的风险原因：封闭的 11 码 / 6 信号词汇，至少一行且不重复。 */
export function deriveJeroRiskReasonsV1(stats: readonly ReviewDiffStat[], manifestPaths: readonly { path: string; oldMode?: string; newMode?: string; modeOnly?: boolean }[]): JeroRiskReasonV1[] {
	const rows: JeroRiskReasonV1[] = [];
	const push = (row: JeroRiskReasonV1) => {
		const key = JSON.stringify([row.code, row.signal ?? "", row.path ?? ""]);
		if (!rows.some((existing) => JSON.stringify([existing.code, existing.signal ?? "", existing.path ?? ""]) === key)) rows.push(row);
	};
	const authored = stats.filter((stat) => !stat.binary && !stat.mode_only);
	if (authored.reduce((total, stat) => total + stat.additions + stat.deletions, 0) > 400) push({ code: "large_change" });
	for (const stat of stats) {
		const tokens = pathTokens(stat.path);
		if (tokens.some((token) => PROCESS_TOKEN.test(token))) {
			push({ code: "process_boundary", signal: "shell_process", path: stat.path });
			continue;
		}
		const riskToken = tokens.find((token) => HIGH_RISK_TOKEN.test(token));
		if (riskToken !== undefined) {
			push({ code: "hot_path", signal: signalForToken(riskToken), path: stat.path });
			continue;
		}
		if (HIGH_RISK_PHRASE.test(stat.path)) push({ code: "hot_path", path: stat.path });
	}
	for (const entry of manifestPaths) {
		if (entry.modeOnly === true) push({ code: "executable_mode", path: entry.path, old_mode: entry.oldMode, new_mode: entry.newMode });
	}
	const binaryPaths = stats.filter((stat) => stat.binary).map(({ path }) => path);
	for (const path of binaryPaths) push({ code: "process_scan_limit", path });
	for (const stat of stats) {
		if (CONFIGURATION_PATH.test(stat.path)) push({ code: "configuration_change", path: stat.path });
	}
	if (rows.length > 0) return rows;
	const executable = stats.find((stat) => !DOCUMENTATION_PATH.test(stat.path) && !CONFIGURATION_PATH.test(stat.path));
	if (executable === undefined) {
		return stats.length === 0 ? [{ code: "empty_content" }] : [{ code: "non_executable_only" }];
	}
	return [{ code: "executable_change", path: executable.path }];
}

function riskEvidencePhrasesV1(stats: readonly ReviewDiffStat[]): string[] {
	const phrases: string[] = [];
	for (const stat of stats) {
		const tokens = pathTokens(stat.path);
		if (tokens.some((token) => PROCESS_TOKEN.test(token))) phrases.push(`code that starts other processes in ${stat.path}`);
		else {
			const riskToken = tokens.find((token) => HIGH_RISK_TOKEN.test(token));
			if (riskToken !== undefined) {
				const signal = signalForToken(riskToken);
				const noun = signal === "auth" ? "authentication and authorization" : signal === "update" ? "update and upgrade" : signal === "security" ? "security-sensitive" : signal === "payments" ? "payment processing" : signal === "permissions" ? "permission handling" : "process-launching";
				phrases.push(`${noun} logic in ${stat.path}`);
			}
		}
	}
	const total = stats.filter((stat) => !stat.binary && !stat.mode_only).reduce((sum, stat) => sum + stat.additions + stat.deletions, 0);
	if (total > 400) phrases.push(`a large change (${total} authored lines)`);
	return [...new Set(phrases)];
}

function assertPairingRulesV1(target: JeroReviewStartTargetV1, selection: JeroReviewStartSelectionV1): void {
	if (target.baseRef !== undefined && target.committedOnly !== true) {
		throw new TypeError("review start: baseRef requires committedOnly === true");
	}
	if (target.baseRef === undefined && target.committedOnly === true) {
		throw new TypeError("review start: committedOnly requires baseRef");
	}

	if (target.targetIdentity !== undefined && !/^sha256:[0-9a-f]{64}$/.test(target.targetIdentity)) {
		throw new TypeError("review start: targetIdentity must be a canonical sha256 identity");
	}
	if (selection.untrackedScope === "exclude" && (selection.intendedUntracked !== undefined || selection.intendedUntrackedSelection !== undefined)) {
		throw new TypeError("review start: untrackedScope exclude cannot carry untracked paths");
	}
	if (selection.untrackedScope === "select") {
		const paths = selection.intendedUntracked ?? [];
		if (paths.length === 0) throw new TypeError("review start: untrackedScope select requires at least one intended path");
		if (selection.intendedUntrackedSelection !== undefined && selection.intendedUntrackedSelection.value.indexOf("{{value}}") !== selection.intendedUntrackedSelection.value.lastIndexOf("{{value}}")) {
			throw new TypeError("review start: intendedUntrackedSelection must carry exactly one {{value}} substitution");
		}
	}
	if (selection.intendedUntracked !== undefined) {
		const seen = new Set<string>();
		for (const path of selection.intendedUntracked) {
			if (typeof path !== "string" || path.length === 0 || path.startsWith("/") || path.includes("\\") || path.split("/").some((part) => part === "" || part === "." || part === "..")) {
				throw new TypeError(`review start: intended untracked path is not repo-relative POSIX: ${JSON.stringify(path)}`);
			}
			if (seen.has(path)) throw new TypeError(`review start: duplicate intended untracked path ${path}`);
			seen.add(path);
		}
	}
}

function modeForLensesV1(requestMode: "ordinary" | "judgment-day", lenses: readonly JeroLensName[]): JeroReviewMode {
	if (requestMode === "judgment-day") return "judgment_day";
	return lenses.length === FULL_4R_LENSES.length ? "ordinary_4r" : "ordinary_bounded";
}

function artifactSubjectsForV1(derivation: JeroSnapshotDerivationV1, lineageId: string, authorityRevision: string, lenses: readonly JeroLensName[]): JeroArtifactSubjectV1[] {
	return lenses.map((lens, order) => ({
		schema: "jero.authority.artifact-subject/v1" as const,
		subject_hash: `sha256:${jeroDomainHash("artifact-subject", {
			target_identity: derivation.target_identity,
			lens,
			selected_order: order,
			base_tree: derivation.record.base_tree,
			candidate_tree: derivation.record.complete_snapshot_tree,
			changed_path_manifest_sha256: derivation.changed_path_manifest_sha256,
		})}`,
		lineage_id: lineageId,
		authority_revision: authorityRevision,
		target_identity: derivation.target_identity,
		base_tree: derivation.record.base_tree,
		candidate_tree: derivation.record.complete_snapshot_tree,
		changed_path_manifest_sha256: derivation.changed_path_manifest_sha256,
		lens,
		selected_order: order,
	}));
}

function zeroedCountersV1(): JeroAuthorityCountersV1 {
	return { full_reviews: 1, refuter_batches: 0, fix_batches: 0, scoped_fix_validations: 0, final_verifications: 0, fix_rounds: 0, scoped_rejudgments: 0, judge_executions: 0 };
}

function buildStartRecordV1(lineageId: string, mode: JeroReviewMode, derivation: JeroSnapshotDerivationV1, snapshotKind: JeroSnapshotKind): JeroReviewTransactionStateV1 {
	const manifestPaths = derivation.changed_path_manifest.map((entry) => entry.path);
	const snapshot: JeroAuthoritySnapshotV1 = {
		kind: snapshotKind,
		base_tree: derivation.record.base_tree,
		candidate_tree: derivation.record.complete_snapshot_tree,
		paths_digest: jeroPathsDigestV1(manifestPaths),
		intended_untracked: derivation.record.intended_untracked,
		intended_untracked_proof: jeroUntrackedInventoryDigestV1(derivation.record.intended_untracked),
		paths: manifestPaths,
		identity: derivation.target_identity,
	};
	return {
		schema: JERO_REVIEW_TRANSACTION_SCHEMA,
		lineage_id: lineageId,
		mode,
		generation: 1,
		state: "reviewing",
		snapshot,
		base_tree: derivation.record.base_tree,
		paths_digest: snapshot.paths_digest,
		initial_review_tree: derivation.record.initial_review_tree,
		final_candidate_tree: derivation.record.initial_review_tree,
		fix_delta_hash: "0".repeat(64),
		policy_hash: derivation.record.policy_hash,
		ledger_hash: "0".repeat(64),
		ledger_findings_hash: "0".repeat(64),
		evidence_hash: "0".repeat(64),
		judge_proofs: [],
		counters: zeroedCountersV1(),
		findings: [],
		classifications: {},
		outcomes: {},
		fix_finding_ids: [],
		pending_refuter_ids: [],
		fix_caused_findings: [],
		follow_ups: [],
		genesis_paths: derivation.record.genesis_paths,
		risk_level: derivation.risk.tier,
		selected_lenses: derivation.record.lenses.filter((lens) => (JERO_LENS_NAMES as readonly string[]).includes(lens)) as JeroLensName[],
		original_changed_lines: derivation.risk.original_changed_lines,
		correction_budget: derivation.risk.correction_budget,
		// M3（§G/差异 #4）：持久化它，使 STATUS 的冻结块始终来自记录，
		// 绝不来自活动的重派生。
		changed_path_manifest_sha256: derivation.changed_path_manifest_sha256,
	};
}

/** 血脉日志持有已完成的 acknowledge 焚毁时为 `true`。 */
export function isJeroLineageConsumedV1(record: JeroLineageStateFileV1): boolean {
	return record.request_journal.some((entry) => entry.operation === "acknowledge" && entry.status === "completed");
}

/**
 * START（spec §B）。输出为保守失败的可辨识联合；同意门只在中/高风险
 * 候选“且”派生身份尚未冻结任何权威时触发（上游
 * native-review-cli.ts:1806-1820——“提供方尚未冻结任何权威”），
 * 因此已存在的 reviewing 血脉恢复时无需重新询问。
 */
export function reviewStartV1(context: JeroAuthorityContextV1, target: JeroReviewStartTargetV1, selection: JeroReviewStartSelectionV1 = {}): JeroReviewStartResultV1 {
	assertPairingRulesV1(target, selection);
	const requestMode = target.requestMode ?? "ordinary";
	// 锁纪律（spec §A.2 非法 #11）：活动的 owned/ambiguous 锁拒绝 START；
	// released（所有者被证明已死）的残留不阻塞。
	const lockStatus = context.locks.inspect();
	if (lockStatus.status === "owned") return { kind: "refused", code: "authority-lock-held", detail: "the authority mutation lock is owned by a live owner" };
	if (lockStatus.status === "ambiguous") return { kind: "refused", code: "authority-lock-ambiguous", detail: "the authority mutation lock is in an ambiguous state" };
	if (lockStatus.status === "released" && lockStatus.owner !== undefined) {
		// 血脉存储现在为每次变更获取该锁（F2），而 acquire() 绝不窃取已
		// 存在的目录：先隔离这个被证明所有者已死的残留，下面的保存才能
		// 获取锁。
		try {
			context.locks.recover(lockStatus.owner.owner_hash);
		} catch (error) {
			return { kind: "refused", code: "authority-lock-ambiguous", detail: `a stale authority lock could not be recovered: ${error instanceof Error ? error.message : String(error)}` };
		}
	}

	const candidateKind = target.committedOnly === true && target.baseRef !== undefined
		? "base-diff" as const
		: target.projection === "staged" ? "staged" as const : "workspace" as const;
	let derivation: JeroSnapshotDerivationV1;
	try {
		derivation = captureJeroReviewSnapshotV1({
			cwd: target.cwd,
			mode: requestMode,
			candidate: candidateKind === "base-diff"
				? { kind: "base-diff", baseRef: target.baseRef! }
				: candidateKind === "staged" ? { kind: "staged" } : { kind: "workspace" },
			policyHash: jeroReviewPolicyHashV1(requestMode),
			storeRoot: context.store.store_root,
		});
	} catch (error) {
		return { kind: "refused", code: "snapshot-failed", detail: error instanceof Error ? error.message : String(error) };
	}

	const targetIdentity = derivation.target_identity;
	if (target.targetIdentity !== undefined && target.targetIdentity !== targetIdentity) {
		return { kind: "refused", code: "identity-mismatch", detail: `expected ${target.targetIdentity}, live candidate freezes as ${targetIdentity}` };
	}
	const lineageId = `review-${targetIdentity.slice(7, 23)}`;
	if (!isJeroLineageId(lineageId)) return { kind: "refused", code: "identity-mismatch", detail: "derived lineage id is invalid" };
	if (target.lineageId !== undefined && target.lineageId !== lineageId) {
		return { kind: "refused", code: "identity-mismatch", detail: `caller bound lineage ${target.lineageId}, candidate derives ${lineageId}` };
	}

	// 冻结前的未跟踪范围校验（F12）：声明的意图路径必须 ⊆ 派生刚刚发现
	// 的活动 `ls-files --others --exclude-standard` 清单——Git 未报告为
	// 未跟踪的路径是调用方对不存在范围的断言。
	if (selection.intendedUntracked !== undefined) {
		const untrackedSet = new Set(derivation.record.intended_untracked);
		const unknown = selection.intendedUntracked.filter((path) => !untrackedSet.has(path));
		if (unknown.length > 0) {
			return { kind: "refused", code: "invalid-request", detail: `intended untracked paths are not in the live untracked inventory: ${unknown.join(", ")}` };
		}
	}

	const untrackedInventory = jeroUntrackedInventoryDigestV1(derivation.record.intended_untracked);
	if (selection.expectedUntrackedInventory !== undefined && selection.expectedUntrackedInventory !== untrackedInventory) {
		return { kind: "blocked-scope-action", reason: "intended-untracked inventory drifted; a fresh inspect is required", expected_untracked_inventory: untrackedInventory, projection: target.projection ?? "workspace" };
	}

	const riskLevel = derivation.risk.tier;
	const changedFiles = derivation.changed_path_manifest.length;
	const changedLines = derivation.risk.original_changed_lines;
	const lenses = derivation.record.lenses.filter((lens) => (JERO_LENS_NAMES as readonly string[]).includes(lens)) as JeroLensName[];

	const requestHash = jeroDomainHash("request", {
		operation: "start",
		lineage_id: lineageId,
		target_identity: targetIdentity,
		base_tree: derivation.record.base_tree,
		candidate_tree: derivation.record.complete_snapshot_tree,
	});
	const idempotencyKey = selection.idempotencyKey ?? `start:${requestHash.slice(0, 16)}`;
	const loaded = context.lineages.load(lineageId);
	if (loaded.kind === "corrupted") return { kind: "refused", code: "corrupted", detail: loaded.detail };
	if (loaded.kind === "ok") {
		const record = loaded.record;
		// 已消费（焚毁）的血脉拒绝一切 START——在重放分支“之前”检查
		// （F9）：默认幂等键下原始 start 条目总能匹配，否则重放会复活一个
		// 已被 acknowledge 焚毁的已批准权威。
		if (isJeroLineageConsumedV1(record)) {
			return { kind: "refused", code: "lineage-consumed", detail: "this candidate's approved authority was consumed by acknowledgement; maintenance (M5) clears consumed lineages" };
		}
		const existingStart = record.request_journal.find((entry) => entry.idempotency_key === idempotencyKey);
		if (existingStart !== undefined) {
			if (existingStart.request_hash !== requestHash) return { kind: "refused", code: "identity-mismatch", detail: "idempotency key was reused with a different request" };
			if (record.state.state === "approved") {
				// 崩溃窗口治愈（F8）：零评审视角的闭合先写日志再写回执；
				// 其间的崩溃在此修复——签发是内容派生的，因此对已持久化
				// 回执的重新签发是字节幂等的。
				const healed = issueJeroReviewReceiptV1(context, record.state);
				if (healed.ok === false) return { kind: "refused", code: "authority-unavailable", detail: healed.detail };
			}
			return {
				kind: "replayed",
				action: "replayed",
				lineage_id: lineageId,
				state: projectJeroReviewStateV1(record.state.state),
				risk_level: record.state.risk_level ?? riskLevel,
				selected_lenses: record.state.selected_lenses ?? [],
				lenses_required: (record.state.selected_lenses?.length ?? 0) > 0,
				changed_files: changedFiles,
				changed_lines: changedLines,
				correction_budget: record.state.correction_budget ?? 0,
				risk_reasons: deriveJeroRiskReasonsV1(derivation.numstat, derivation.changed_path_manifest),
				artifact_subjects: artifactSubjectsForV1(derivation, lineageId, computeJeroLineageRevisionV1({ state: record.state, request_journal: record.request_journal.filter((entry) => entry.idempotency_key !== idempotencyKey) }), record.state.selected_lenses ?? []),
				target_identity: targetIdentity,
				projection: target.projection ?? "workspace",
				revision: record.revision,
				replayability: "exact_replay_safe" as const,
				mode: record.state.mode,
			};
		}
		if (record.state.state !== "reviewing" || record.state.snapshot.identity !== targetIdentity) {
			return { kind: "refused", code: "lineage-not-startable", detail: `lineage ${lineageId} is in persisted state ${record.state.state}` };
		}
		// 活动的 reviewing 血脉恢复时“不”重新询问同意（F10）：下面的门
		// 只在该候选尚未冻结任何权威时触发。
		return {
			kind: "resumed",
			action: "resumed",
			lineage_id: lineageId,
			state: "reviewing",
			risk_level: record.state.risk_level ?? riskLevel,
			selected_lenses: record.state.selected_lenses ?? [],
			lenses_required: (record.state.selected_lenses?.length ?? 0) > 0,
			changed_files: changedFiles,
			changed_lines: changedLines,
			correction_budget: record.state.correction_budget ?? 0,
			risk_reasons: deriveJeroRiskReasonsV1(derivation.numstat, derivation.changed_path_manifest),
			artifact_subjects: artifactSubjectsForV1(derivation, lineageId, computeJeroLineageRevisionV1({ state: record.state, request_journal: [] }), record.state.selected_lenses ?? []),
			target_identity: targetIdentity,
			projection: target.projection ?? "workspace",
			repository_context: mintJeroRepositoryContextV1(context, record, "status"),
			revision: record.revision,
			replayability: "not_replayable" as const,
			mode: record.state.mode,
		};
	}

	// §B.5 同意门（仅创建路径，F10）：模式开启下中/高风险且无答案或
	// 常设授权时不冻结任何权威。上游只在该候选尚未冻结任何权威时询问
	// （native-review-cli.ts:1806-1820），因此上面的恢复与重放绕过它。
	const modeState = effectiveJeroReviewModeV1(context.store.store_root, { globalModePath: context.globalReviewModePath });
	const consentRequired = (riskLevel === "medium" || riskLevel === "high") &&
		modeState.effective === "on" && selection.consent === undefined && selection.standingGrant !== true;
	if (consentRequired) {
		return {
			kind: "consent_required",
			action: "consent_required",
			target_identity: targetIdentity,
			projection: target.projection ?? "workspace",
			risk_level: riskLevel as "medium" | "high",
			changed_files: changedFiles,
			changed_lines: changedLines,
			risk_evidence: riskEvidencePhrasesV1(derivation.numstat),
		};
	}
	if (selection.consent === "declined") {
		return {
			kind: "declined",
			action: "declined",
			consent: "declined_this_candidate",
			target_identity: targetIdentity,
			projection: target.projection ?? "workspace",
			risk_level: riskLevel as "medium" | "high",
			changed_files: changedFiles,
			changed_lines: changedLines,
			lineage_id: "",
			state: "",
			lenses_required: false,
			selected_lenses: [],
			lens_bindings: [],
			correction_budget: 0,
		};
	}

	const mode = modeForLensesV1(requestMode, lenses);
	const record = buildStartRecordV1(lineageId, mode, derivation, candidateKind === "base-diff" ? "base-diff" : "current-changes");
	const riskReasons = deriveJeroRiskReasonsV1(derivation.numstat, derivation.changed_path_manifest);

	// 零评审视角的低风险闭合（§A.2 行 1b）：立即 approved，立即写回执；
	// 预算仍然冻结。
	if (requestMode === "ordinary" && lenses.length === 0) {
		record.state = "approved";
	}
	const canonicalResult = { action: record.state === "approved" ? "closed" : "created", lineage_id: lineageId, state: record.state, target_identity: targetIdentity, correction_budget: record.correction_budget };
	const draft = { state: record, request_journal: [{ operation: "start" as const, idempotency_key: idempotencyKey, request_hash: requestHash, status: "completed" as const, canonical_result: canonicalResult }] };
	let revision: string;
	try {
		revision = context.lineages.save(lineageId, draft, { expectedRevision: null }).revision;
	} catch (error) {
		return { kind: "refused", code: "authority-unavailable", detail: error instanceof Error ? error.message : String(error) };
	}
	if (record.state === "approved") {
		const receipt = issueJeroReviewReceiptV1(context, record);
		if (receipt.ok === false) return { kind: "refused", code: "authority-unavailable", detail: receipt.detail };
	}
	const authorityRevision = computeJeroLineageRevisionV1({ state: record, request_journal: [] });
	const shared = {
		lineage_id: lineageId,
		state: projectJeroReviewStateV1(record.state),
		risk_level: riskLevel,
		selected_lenses: lenses,
		lenses_required: lenses.length > 0,
		changed_files: changedFiles,
		changed_lines: changedLines,
		correction_budget: record.correction_budget,
		risk_reasons: riskReasons,
		target_identity: targetIdentity,
		projection: target.projection ?? "workspace",
		revision,
		replayability: "exact_replay_safe" as const,
		mode,
	};
	if (record.state === "approved") {
		// 零评审视角闭合不创建评审视角主题（fixture：artifact_subjects []）。
		return { kind: "closed", action: "closed", ...shared, artifact_subjects: [] };
	}
	return {
		kind: "created",
		action: "created",
		...shared,
		artifact_subjects: artifactSubjectsForV1(derivation, lineageId, authorityRevision, lenses),
		repository_context: mintJeroRepositoryContextV1(context, { schema: JERO_LINEAGE_STATE_SCHEMA, lineage_id: lineageId, revision, state: record, request_journal: [{ operation: "start" as const, idempotency_key: idempotencyKey, request_hash: requestHash, status: "completed" as const }] }, "start"),
	};
}
