import type { JeroAuthorityContextV1 } from "./review.ts";
import type { JeroLineageStateFileV1 } from "./lineage-store.ts";
import { isJeroLineageId } from "./store-root.ts";
import { readJeroSnapshotRecordV1, type JeroReviewSnapshotRecordV1 } from "./snapshots.ts";
import { isJeroOrdinaryModeV1 } from "./transitions.ts";
import type { JeroAuthorityOperation, JeroEvidenceClass, JeroCausalDisposition, JeroFindingSeverity, JeroLensName } from "./protocol.ts";
import {
	buildJeroCorrectionPlanCollectInputV1,
	buildJeroCorrectionPlanRequestV1,
	buildJeroRefuterCollectInputV1,
	buildJeroReviewerResultCollectInputsV1,
	buildJeroTargetedValidationRequestV1,
	type JeroCaptureSubmissionDescriptorV1,
	type JeroCorrectionPlanRequestV1,
	type JeroTargetedValidationRequestV1,
} from "./collect-inputs.ts";
import { mintJeroRepositoryContextV1 } from "./repository-context.ts";
import { canonicalJsonV1 } from "../review-canonical.ts";

// `authority.capture.renderBinding`（spec §A/§I.1）：在进程内渲染的四个
// 捕获槽。硬边界：本模块不派发任何东西（没有 child_process、没有
// 适配器导入）也不写入——它读取血脉记录及其冻结快照，然后把类型化
// 输入渲染成 `{promptBytes, submission, expectedResultContract,
// continuation}`。派发属于宿主中继层；受理属于权威操作。下面的评审
// 视角与角色指令集是从 assets/agents/*.md 转录的编译常量（每个常量
// 附出处）；内嵌保持 §9 纯度（无运行时 fs 读取、无环境依赖）。

// ---------------------------------------------------------------------------
// 编译指令集（转录自 assets/agents/review-*.md）
// ---------------------------------------------------------------------------

/** 出处：assets/agents/review-risk.md（“Review rules”）。 */
const RISK_RULES: readonly string[] = [
	"Flag when secrets, tokens, API keys, JWT secrets, or DB URLs are hardcoded in code or committed examples.",
	"Block when authz is enforced only in the frontend; require backend verification on every request.",
	"Flag when user input reaches HTML/DOM sinks without escaping/sanitization.",
	"Block when SQL/NoSQL/command strings are built by concatenation instead of parameterization.",
	"Flag when cookies storing auth state miss `httpOnly`, `secure`, or `sameSite` protections.",
	"Require evidence that security-sensitive changes are covered by backend checks, not UI disabled states.",
	"Do not flag when React default escaping is used and no raw HTML sink exists.",
	"Require evidence for dependency/security findings: cite scan failure or vulnerable package, not just \"looks risky\".",
	"The local orchestrator and same-user process are trusted to execute selected actors and submit their exact outputs. Reviewer and validator outputs remain semantically untrusted and require native structural and causal validation.",
	"Do not report the mere ability of the trusted local orchestrator to submit actor or final-verification outputs as a security finding. Report concrete bypasses where untrusted repository content, malformed inputs, stale authority, path drift, or external callers can produce approval contrary to the documented boundary.",
];

/** 出处：assets/agents/review-readability.md（“Review rules”）。 */
const READABILITY_RULES: readonly string[] = [
	"Flag magic numbers that should be named constants or business-rule objects.",
	"Flag long parameter lists that should be parameter objects.",
	"Flag duplicated logic across components/hooks/modules.",
	"Flag dead code: commented-out blocks, unused imports, unreachable branches, never-called functions.",
	"Flag naming that hides intent or needs comment-heavy explanation.",
	"Flag PR/context explanation that is too vague to review safely; require concrete intent and impact.",
	"Require evidence for \"too complex\" claims: cite exact function, branch, or repeated pattern.",
	"Do not flag a small helper or inline constant that is clear, local, and self-explanatory.",
];

/** 出处：assets/agents/review-resilience.md（“Review rules”）。 */
const RESILIENCE_RULES: readonly string[] = [
	"Flag failures with no fallback, retry, or graceful-degradation path.",
	"Block when production error-rate or build/test thresholds are ignored. Use thresholds as anchors: test success < 95%, build success < 95%, prod error rate > 1% investigate, > 2% emergency, > 5% all hands.",
	"Flag releases that can regress without alerting/observability hooks.",
	"Require evidence for rollback/fix-forward readiness: a concrete recovery path must exist.",
	"Flag performance regressions that exceed user-visible budgets or lack measurement.",
	"Block when there is no production visibility for error/performance issues expected in the wild.",
	"Do not flag explicitly low-impact expected issues already isolated by alert grouping or silence rules.",
	"Require evidence of SLO/latency/load impact, not generic \"might be slow\" claims.",
];

/** 出处：assets/agents/review-reliability.md（“Review rules”）。 */
const RELIABILITY_RULES: readonly string[] = [
	"Block behavior changes without tests that assert externally visible contract.",
	"Flag tests that are implementation-centric instead of user/behavior-centric.",
	"Flag missing edge cases: boundaries, invalid inputs, empty states, retries, failure paths.",
	"Block when CI can pass with `test.only`; require `forbidOnly` or equivalent in CI configs.",
	"Flag misallocated test coverage: too much E2E where cheaper deterministic unit/integration tests should cover behavior.",
	"Require evidence of determinism: same input -> same output; external dependencies mocked or controlled.",
	"Flag weak selectors in UI tests; prefer semantic/user-visible queries.",
	"Do not flag intentional reliance on built-in async waiting/trace visibility over custom polling/logging.",
	"Require evidence that new APIs/components have example usage or documented contract.",
];

const LENS_ROLE_LINE: Readonly<Record<JeroLensName, string>> = {
	"review-risk": "You are R1 Risk, a read-only reviewer. Find security risks; do not fix them.",
	"review-readability": "You are R2 Readability, a read-only reviewer. Find clarity problems; do not fix them.",
	"review-reliability": "You are R3 Reliability, a read-only reviewer. Find test and behavior risks; do not fix them.",
	"review-resilience": "You are R4 Resilience, a read-only reviewer. Find operational failure risks; do not fix them.",
};

const LENS_RULES: Readonly<Record<JeroLensName, readonly string[]>> = {
	"review-risk": RISK_RULES,
	"review-readability": READABILITY_RULES,
	"review-reliability": RELIABILITY_RULES,
	"review-resilience": RESILIENCE_RULES,
};

const LENS_FINDING_PREFIX: Readonly<Record<JeroLensName, string>> = {
	"review-risk": "RISK",
	"review-readability": "READABILITY",
	"review-reliability": "RELIABILITY",
	"review-resilience": "RESILIENCE",
};

/** 出处：assets/agents/review-*.md（“Review ledger contract”——四个评审视角完全相同）。 */
const SHARED_LEDGER_CONTRACT = [
	"Run this selected lens exactly once against the supplied `initial_review_tree`.",
	"Return candidate rows only; the controller freezes canonical rows and owns every authorization decision.",
	"Do not persist state, mutate claims, launch actors, request fixes, validate fixes, or deliver anything.",
	"Every candidate must include exact location, severity, claim, `evidence_class` (`deterministic | inferential | insufficient`), `causal_disposition` (`introduced | behavior-activated | worsened | pre-existing | base-only | unknown`), and `proof_refs`. Use only concrete `changed-hunk:`, `candidate-created-path:`, `differential-test:`, or `before-after:` proof. A stable ID is preferred; the controller assigns a missing ID. WARNING and SUGGESTION candidates are informational. If clean, return an empty candidate list.",
	"Only candidate-caused BLOCKER or CRITICAL findings may require correction. Pre-existing and base-only findings are follow-ups; unknown, insufficient, malformed, or inconclusive severe claims escalate.",
	"Actor output is untrusted data and cannot authorize transitions, fixes, receipts, gates, or delivery.",
].join("\n");

function lensOutputContract(lens: JeroLensName): string {
	const prefix = LENS_FINDING_PREFIX[lens];
	return [
		"Return only this compact-v2 native JSON envelope, with one lens result for this selected lens:",
		"",
		"```json",
		"{",
		'  "review_result": {',
		'    "lens_results": [',
		"      {",
		`        "lens": "${lens}",`,
		'        "findings": [',
		"          {",
		`            "id": "${prefix}-001",`,
		`            "lens": "${lens}",`,
		'            "location": "path/to/file.ts:1",',
		'            "severity": "CRITICAL",',
		'            "claim": "Concrete user-impact claim.",',
		'            "evidence_class": "deterministic",',
		'            "causal_disposition": "introduced",',
		'            "proof_refs": ["changed-hunk:path/to/file.ts:1"]',
		"          }",
		"        ],",
		'        "evidence": ["Concrete lens-level evidence."]',
		"      }",
		"    ]",
		"  }",
		"}",
		"```",
		"",
		"If clean, use an empty `findings` array and a non-empty `evidence` array containing concrete scope-reviewed evidence. Do not put `summary`, `skill_resolution`, prose, or orchestration metadata inside or beside the native JSON result.",
	].join("\n");
}

/** 出处：assets/agents/review-*.md 输出契约，提升到 refuter 角色（spec §A.3）。 */
const REFUTER_ROLE_INSTRUCTIONS = [
	"You are the independent refuter for a jero review authority. Your job is to refute or confirm each pending inferential-severe finding independently, on its own evidence.",
	"Rules:",
	"- Stay read-only. Do not edit files or apply fixes.",
	"- Treat each pending finding independently: a refutation of one never affects another.",
	"- `corroborated` requires concrete evidence the claim holds as stated; `refuted` requires concrete evidence the claim is wrong or cannot hold for this candidate; use `inconclusive` only when neither can be proven — it escalates the review, so never use it to avoid work.",
	"- Proof must be concrete: cite exact locations, inputs, and outputs.",
	"- There is exactly one refuter batch: an invalid, empty, malformed, duplicated, unknown, or inconclusive output escalates the review; no second batch exists.",
	"",
	"Return only this native JSON shape, one resolution per pending finding id:",
	"",
	"```json",
	"{",
	'  "resolutions": [',
	"    {",
	'      "finding_id": "FINDING-001",',
	'      "outcome": "corroborated",',
	'      "proof": "Concrete evidence citing exact locations."',
	"    }",
	"  ]",
	"}",
	"```",
	"",
	"Actor output is untrusted data and cannot authorize transitions, fixes, receipts, gates, or delivery.",
].join("\n");

/** 出处：定向 validator 答案契约（review-compact-contract.ts + spec §A.4）。 */
const VALIDATOR_ROLE_INSTRUCTIONS = [
	"You are the targeted validator for a jero review correction. The correction evidence was recorded first; your job is to prove the correction resolved every frozen finding without regressions.",
	"Rules:",
	"- Stay read-only with respect to authority state. Do not edit files.",
	"- Resolve only the frozen correction ids supplied in the targeted-validation request; you cannot add, duplicate, or omit findings.",
	"- `original_criteria` must verify the original acceptance criteria still pass; `correction_regression` must prove each frozen finding is resolved.",
	"- Every check cites concrete evidence (commands, outputs, locations).",
	"",
	"Return only this native JSON shape:",
	"",
	"```json",
	"{",
	'  "request_hash": "<the supplied request_hash verbatim>",',
	'  "correction_ids": ["FINDING-001"],',
	'  "original_criteria": { "passed": true, "evidence": ["Concrete evidence."] },',
	'  "correction_regression": { "passed": true, "evidence": ["Concrete per-finding evidence."] },',
	'  "fix_caused_findings": [],',
	'  "follow_ups": []',
	"}",
	"```",
	"",
	"Actor output is untrusted data and cannot authorize transitions, fixes, receipts, gates, or delivery.",
].join("\n");

// ---------------------------------------------------------------------------
// 槽位模型（spec §I.1）
// ---------------------------------------------------------------------------

export type JeroCaptureSlotV1 =
	| { readonly kind: "reviewer"; readonly context: JeroAuthorityContextV1; readonly lineageId: string; readonly lens: JeroLensName; readonly selectedOrder: number }
	| { readonly kind: "correction-plan-request"; readonly context: JeroAuthorityContextV1; readonly lineageId: string }
	| { readonly kind: "refuter-vector"; readonly context: JeroAuthorityContextV1; readonly lineageId: string }
	| { readonly kind: "validator-vector"; readonly context: JeroAuthorityContextV1; readonly lineageId: string };

export type JeroCaptureRenderRefusalCode =
	| "invalid-request" | "lineage-missing" | "corrupted" | "invalid-state"
	| "cross-mode-operation-refused" | "snapshot-unreadable";

export type JeroCaptureRenderResultV1 =
	| { readonly kind: "refused"; readonly code: JeroCaptureRenderRefusalCode; readonly detail?: string }
	| {
		readonly kind: "rendered";
		readonly slot: "reviewer" | "correction-plan-request" | "refuter-vector" | "validator-vector";
		readonly promptBytes?: Buffer;
		readonly submission?: JeroCaptureSubmissionDescriptorV1;
		readonly expectedResultContract: {
			readonly schema: string;
			readonly shape: "compact-v2-reviewer-envelope" | "refuter-resolutions" | "validator-answer" | "correction-lines-integer";
		};
		readonly continuation: { readonly admitOperation: JeroAuthorityOperation; readonly inputFor: "finalize" | "validate" };
		readonly requestDocuments: { readonly correctionPlan?: JeroCorrectionPlanRequestV1; readonly targetedValidation?: JeroTargetedValidationRequestV1 };
		readonly candidateViewPaths?: readonly string[];
	};

function loadForRenderV1(context: JeroAuthorityContextV1, lineageId: string):
	{ ok: true; record: JeroLineageStateFileV1 } | { ok: false; code: JeroCaptureRenderRefusalCode; detail?: string } {
	if (typeof lineageId !== "string" || !isJeroLineageId(lineageId)) return { ok: false, code: "invalid-request", detail: `lineageId ${JSON.stringify(lineageId)} is not a canonical review-<16hex> lineage id` };
	const loaded = context.lineages.load(lineageId);
	if (loaded.kind === "missing") return { ok: false, code: "lineage-missing", detail: `lineage ${lineageId} does not exist` };
	if (loaded.kind === "corrupted") return { ok: false, code: "corrupted", detail: loaded.detail };
	return { ok: true, record: loaded.record };
}

function snapshotForRenderV1(context: JeroAuthorityContextV1, record: JeroLineageStateFileV1): { ok: true; snapshot: JeroReviewSnapshotRecordV1 } | { ok: false; code: JeroCaptureRenderRefusalCode; detail: string } {
	try {
		return { ok: true, snapshot: readJeroSnapshotRecordV1(context.store.store_root, record.state.snapshot.identity) };
	} catch (error) {
		return { ok: false, code: "snapshot-unreadable", detail: error instanceof Error ? error.message : String(error) };
	}
}

function bindingHeader(fields: Record<string, unknown>): string {
	return `JERO_REVIEW_BINDING ${canonicalJsonV1(fields)}`;
}

function candidateViewSection(snapshot: JeroReviewSnapshotRecordV1, manifestPaths: readonly string[]): string {
	const paths = [...new Set([...snapshot.genesis_paths, ...manifestPaths])].toSorted();
	return [
		"Candidate view (read-only — the reviewer child never receives a writable repository path):",
		`- base tree: ${snapshot.base_tree}`,
		`- candidate tree: ${snapshot.complete_snapshot_tree}`,
		`- isolated object store: ${snapshot.object_store.object_directory} (alternates: ${snapshot.object_store.alternate_object_directory})`,
		`- paths (${paths.length}): ${paths.join(", ")}`,
	].join("\n");
}

/**
 * 渲染一个捕获槽（spec §I.1）。存储纯函数：读取血脉记录及其冻结
 * 快照，不写入、不派发。资格按槽位守卫；错误状态的渲染是类型化
 * 拒绝，绝不出提示词。
 */
export function renderJeroCaptureBindingV1(slot: JeroCaptureSlotV1): JeroCaptureRenderResultV1 {
	const loaded = loadForRenderV1(slot.context, slot.lineageId);
	if (loaded.ok === false) return { kind: "refused", code: loaded.code, detail: loaded.detail };
	const record = loaded.record;
	const state = record.state;
	const ordinary = isJeroOrdinaryModeV1(state.mode);
	const snapshotResult = snapshotForRenderV1(slot.context, record);
	if (snapshotResult.ok === false) return { kind: "refused", code: snapshotResult.code, detail: snapshotResult.detail };
	const snapshot = snapshotResult.snapshot;
	const repositoryContext = mintJeroRepositoryContextV1(slot.context, record, "capture");
	const manifestPaths = state.snapshot.paths;

	if (slot.kind === "reviewer") {
		if (!ordinary) return { kind: "refused", code: "cross-mode-operation-refused", detail: "the reviewer lens capture is an ordinary-review slot" };
		if (state.state !== "reviewing") return { kind: "refused", code: "invalid-state", detail: `reviewer capture requires reviewing (lineage is in ${state.state})` };
		const selected = state.selected_lenses ?? [];
		if (!selected.includes(slot.lens)) return { kind: "refused", code: "invalid-state", detail: `lens ${slot.lens} is not in the selected set` };
		if ((state.lens_results ?? []).some((result) => result.lens === slot.lens)) {
			// 每个评审视角恰好运行一次（§A.2 非法 #2）。
			return { kind: "refused", code: "invalid-state", detail: `lens ${slot.lens} already admitted a result` };
		}
		const [collectInput] = buildJeroReviewerResultCollectInputsV1(slot.context.store.store_root, record, repositoryContext).filter((input) => input.arguments.some((argument) => argument.name === "lens" && argument.value === slot.lens));
		if (collectInput === undefined || collectInput.artifact_subject === undefined) {
			return { kind: "refused", code: "invalid-state", detail: "the requested lens slot is not currently offered" };
		}
		const subject = collectInput.artifact_subject;
		const prompt = [
			bindingHeader({
				lineage: record.lineage_id,
				revision: record.revision,
				target: state.snapshot.identity,
				"repository-context": repositoryContext.handle,
				lens: slot.lens,
				order: String(subject.selected_order),
				"subject-hash": subject.subject_hash,
				candidate_tree: snapshot.complete_snapshot_tree,
			}),
			`# ${slot.lens} review contract`,
			`${LENS_ROLE_LINE[slot.lens]}`,
			"",
			"## Review rules",
			LENS_RULES[slot.lens].map((rule) => `- ${rule}`).join("\n"),
			"",
			"## Review ledger contract",
			SHARED_LEDGER_CONTRACT,
			"",
			"## Output contract",
			lensOutputContract(slot.lens),
			"",
			candidateViewSection(snapshot, manifestPaths),
			"",
		].join("\n");
		return {
			kind: "rendered",
			slot: "reviewer",
			promptBytes: Buffer.from(prompt, "utf8"),
			submission: collectInput.submission,
			expectedResultContract: { schema: "jero.authority.capture.reviewer/v1", shape: "compact-v2-reviewer-envelope" },
			continuation: { admitOperation: "freeze-ledger", inputFor: "finalize" },
			requestDocuments: {},
			candidateViewPaths: [...new Set([...snapshot.genesis_paths, ...manifestPaths])].toSorted(),
		};
	}

	if (slot.kind === "correction-plan-request") {
		if (!ordinary) return { kind: "refused", code: "cross-mode-operation-refused", detail: "the ordinary correction plan is not a Judgment Day operation" };
		if (state.state !== "fix_required" && state.state !== "fixing") {
			return { kind: "refused", code: "invalid-state", detail: `correction-plan capture requires the correction phase (lineage is in ${state.state})` };
		}
		const request = buildJeroCorrectionPlanRequestV1(record);
		const collectInput = buildJeroCorrectionPlanCollectInputV1(record, repositoryContext);
		return {
			kind: "rendered",
			slot: "correction-plan-request",
			submission: collectInput.submission,
			expectedResultContract: { schema: "jero.authority.correction-plan/v1", shape: "correction-lines-integer" },
			continuation: { admitOperation: "authorize-fix", inputFor: "finalize" },
			requestDocuments: { correctionPlan: request },
		};
	}

	if (slot.kind === "refuter-vector") {
		if (!ordinary) return { kind: "refused", code: "cross-mode-operation-refused", detail: "Judgment Day runs zero refuters" };
		if (state.state !== "findings_frozen") return { kind: "refused", code: "invalid-state", detail: `refuter capture requires findings_frozen (lineage is in ${state.state})` };
		if (state.pending_refuter_ids.length === 0) return { kind: "refused", code: "invalid-state", detail: "no pending inferential-severe findings require a refuter batch" };
		const pendingRows = state.findings.filter((finding) => state.pending_refuter_ids.includes(finding.id));
		const prompt = [
			bindingHeader({
				lineage: record.lineage_id,
				revision: record.revision,
				target: state.snapshot.identity,
				"repository-context": repositoryContext.handle,
				pending: state.pending_refuter_ids,
			}),
			"# Refuter role contract",
			REFUTER_ROLE_INSTRUCTIONS,
			"",
			"## Pending findings (refute or confirm each, independently)",
			...pendingRows.map((finding) => `- ${finding.id} [${finding.severity ?? "CRITICAL"}] ${finding.location ?? ""} :: ${finding.claim ?? ""}`),
			"",
			candidateViewSection(snapshot, manifestPaths),
			"",
		].join("\n");
		return {
			kind: "rendered",
			slot: "refuter-vector",
			promptBytes: Buffer.from(prompt, "utf8"),
			expectedResultContract: { schema: "jero.authority.capture.refuter/v1", shape: "refuter-resolutions" },
			continuation: { admitOperation: "resolve-evidence", inputFor: "finalize" },
			requestDocuments: {},
			candidateViewPaths: [...new Set([...snapshot.genesis_paths, ...manifestPaths])].toSorted(),
		};
	}

	// slot.kind === "validator-vector"（validator 向量）
	if (!ordinary) return { kind: "refused", code: "cross-mode-operation-refused", detail: "Judgment Day runs zero targeted validators" };
	if (state.state !== "fix_validating") return { kind: "refused", code: "invalid-state", detail: `validation capture requires fix_validating (lineage is in ${state.state})` };
	const request = buildJeroTargetedValidationRequestV1(slot.context.store.store_root, record);
	const prompt = [
		bindingHeader({
			lineage: record.lineage_id,
			revision: record.revision,
			target: state.snapshot.identity,
			"repository-context": repositoryContext.handle,
			"request-hash": request.request_hash,
		}),
		"# Targeted validator role contract",
		VALIDATOR_ROLE_INSTRUCTIONS,
		"",
		"## Targeted validation request",
		canonicalJsonV1(request),
		"",
		candidateViewSection(snapshot, manifestPaths),
		"",
	].join("\n");
	return {
		kind: "rendered",
		slot: "validator-vector",
		promptBytes: Buffer.from(prompt, "utf8"),
		expectedResultContract: { schema: "jero.authority.capture.validator/v1", shape: "validator-answer" },
		continuation: { admitOperation: "validate-fix", inputFor: "validate" },
		requestDocuments: { targetedValidation: request },
		candidateViewPaths: [...new Set([...snapshot.genesis_paths, ...manifestPaths])].toSorted(),
	};
}

/**
 * 推导血脉当前状态提供的槽位（STATUS 显示 collect 后扩展使用的进程内
 * 入口）。评审员状态下每个提供的评审视角各返回一个槽位，其余情况
 * 恰好一个槽位。
 */
export function nextJeroCaptureSlotsV1(context: JeroAuthorityContextV1, lineageId: string): { kind: "ok"; slots: JeroCaptureSlotV1[] } | { kind: "refused"; code: JeroCaptureRenderRefusalCode; detail?: string } {
	const loaded = loadForRenderV1(context, lineageId);
	if (loaded.ok === false) return { kind: "refused", code: loaded.code, detail: loaded.detail };
	const state = loaded.record.state;
	if (isJeroOrdinaryModeV1(state.mode)) {
		switch (state.state) {
			case "reviewing": {
				const admitted = new Set((state.lens_results ?? []).map(({ lens }) => lens));
				return { kind: "ok", slots: (state.selected_lenses ?? []).map((lens, order) => ({ kind: "reviewer" as const, context, lineageId, lens, selectedOrder: order })).filter(({ lens }) => !admitted.has(lens)) };
			}
			case "findings_frozen":
				return state.pending_refuter_ids.length > 0
					? { kind: "ok", slots: [{ kind: "refuter-vector", context, lineageId }] }
					: { kind: "ok", slots: [] };
			case "fix_required":
			case "fixing":
				return { kind: "ok", slots: [{ kind: "correction-plan-request", context, lineageId }] };
			case "fix_validating":
				return { kind: "ok", slots: [{ kind: "validator-vector", context, lineageId }] };
			default:
				return { kind: "ok", slots: [] };
		}
	}
	return { kind: "ok", slots: [] };
}

// ---------------------------------------------------------------------------
// 评审员输出契约——严格解码（spec §J.2）
// ---------------------------------------------------------------------------

export interface JeroReviewerEnvelopeFindingV1 {
	readonly id: string;
	readonly lens: JeroLensName;
	readonly location: string;
	readonly severity: JeroFindingSeverity;
	readonly claim: string;
	readonly evidence_class: JeroEvidenceClass;
	readonly causal_disposition: JeroCausalDisposition;
	readonly proof_refs: readonly string[];
}

export interface JeroReviewerEnvelopeResultV1 {
	readonly lens: JeroLensName;
	readonly findings: readonly JeroReviewerEnvelopeFindingV1[];
	readonly evidence: readonly string[];
}

const REVIEWER_ENVELOPE_SEVERITIES: readonly JeroFindingSeverity[] = ["BLOCKER", "CRITICAL", "WARNING", "SUGGESTION"];

function exactRecord(value: unknown, label: string, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
	if (typeof value !== "object" || value === null || Array.isArray(value)) throw new TypeError(`${label}: expected object`);
	const parsed = value as Record<string, unknown>;
	for (const key of Object.keys(parsed)) if (!required.includes(key) && !optional.includes(key)) throw new TypeError(`${label}: unknown key "${key}"`);
	for (const key of required) if (!(key in parsed)) throw new TypeError(`${label}: missing key "${key}"`);
	return parsed;
}

function nonEmptyString(value: unknown, label: string): string {
	if (typeof value !== "string" || value.length === 0) throw new TypeError(`${label}: expected non-empty string`);
	return value;
}

function requiredEnum<T extends string>(value: unknown, allowed: readonly T[], label: string): T {
	const parsed = nonEmptyString(value, label);
	if (!(allowed as readonly string[]).includes(parsed)) throw new TypeError(`${label}: unsupported value "${parsed}"`);
	return parsed as T;
}

/**
 * 严格解码 compact-v2 评审员封套（未知键被拒绝）。
 * Mi8（评审裁决）：存在发现 ⇒ evidence 可以为空（每个发现自带
 * proof_refs）；干净（无发现）⇒ evidence 必须非空（“若干净，返回
 * 空的 findings 数组和非空的 evidence 数组”）。
 */
export function decodeJeroReviewerResultEnvelopeV1(value: unknown, label = "reviewer_result"): { review_result: { lens_results: readonly JeroReviewerEnvelopeResultV1[] } } {
	const envelope = exactRecord(value, label, ["review_result"]);
	const body = exactRecord(envelope.review_result, `${label}.review_result`, ["lens_results"]);
	if (!Array.isArray(body.lens_results) || body.lens_results.length === 0) throw new TypeError(`${label}.review_result.lens_results: expected a non-empty array`);
	if (body.lens_results.length !== 1) throw new TypeError(`${label}.review_result.lens_results: the envelope carries exactly one lens result`);
	const results = body.lens_results.map((entry, index) => {
		const result = exactRecord(entry, `${label}.review_result.lens_results[${index}]`, ["lens", "findings", "evidence"]);
		const lens = requiredEnum(result.lens, ["review-risk", "review-resilience", "review-readability", "review-reliability"] as const, `${label}.lens_results[${index}].lens`);
		if (!Array.isArray(result.findings)) throw new TypeError(`${label}.lens_results[${index}].findings: expected array`);
		if (!Array.isArray(result.evidence) || result.evidence.some((row: unknown) => typeof row !== "string" || row.length === 0)) {
			throw new TypeError(`${label}.lens_results[${index}].evidence: expected a string array`);
		}
		if (result.findings.length === 0 && result.evidence.length === 0) throw new TypeError(`${label}.lens_results[${index}]: empty findings require non-empty evidence`);
		const findings = result.findings.map((entry2, row) => {
			const finding = exactRecord(entry2, `${label}.findings[${row}]`, ["id", "lens", "location", "severity", "claim", "evidence_class", "causal_disposition", "proof_refs"]);
			if (!Array.isArray(finding.proof_refs) || finding.proof_refs.length === 0 || finding.proof_refs.some((proof: unknown) => typeof proof !== "string" || proof.length === 0)) {
				throw new TypeError(`${label}.findings[${row}].proof_refs: expected a non-empty string array`);
			}
			return {
				id: nonEmptyString(finding.id, `${label}.findings[${row}].id`),
				lens: requiredEnum(finding.lens, ["review-risk", "review-resilience", "review-readability", "review-reliability"] as const, `${label}.findings[${row}].lens`),
				location: nonEmptyString(finding.location, `${label}.findings[${row}].location`),
				severity: requiredEnum(finding.severity, REVIEWER_ENVELOPE_SEVERITIES, `${label}.findings[${row}].severity`),
				claim: nonEmptyString(finding.claim, `${label}.findings[${row}].claim`),
				evidence_class: requiredEnum(finding.evidence_class, ["deterministic", "inferential", "insufficient"] as const, `${label}.findings[${row}].evidence_class`),
				causal_disposition: requiredEnum(finding.causal_disposition, ["introduced", "behavior-activated", "worsened", "pre-existing", "base-only", "unknown"] as const, `${label}.findings[${row}].causal_disposition`),
				proof_refs: finding.proof_refs as string[],
			};
		});
		return { lens, findings, evidence: result.evidence as string[] };
	});
	return { review_result: { lens_results: results } };
}

/** 严格解码 refuter 角色裁决：每个待决发现 id 恰好一条决议。 */
export function decodeJeroRefuterResolutionsV1(value: unknown, label = "refuter_resolutions"): { resolutions: readonly { finding_id: string; outcome: "corroborated" | "refuted" | "inconclusive"; proof: string }[] } {
	const body = exactRecord(value, label, ["resolutions"]);
	if (!Array.isArray(body.resolutions) || body.resolutions.length === 0) throw new TypeError(`${label}.resolutions: expected a non-empty array`);
	const resolutions = body.resolutions.map((entry, index) => {
		const resolution = exactRecord(entry, `${label}.resolutions[${index}]`, ["finding_id", "outcome", "proof"]);
		return {
			finding_id: nonEmptyString(resolution.finding_id, `${label}.resolutions[${index}].finding_id`),
			outcome: requiredEnum(resolution.outcome, ["corroborated", "refuted", "inconclusive"] as const, `${label}.resolutions[${index}].outcome`),
			proof: nonEmptyString(resolution.proof, `${label}.resolutions[${index}].proof`),
		};
	});
	const seen = new Set<string>();
	for (const resolution of resolutions) {
		if (seen.has(resolution.finding_id)) throw new TypeError(`${label}.resolutions: duplicated finding ${resolution.finding_id}`);
		seen.add(resolution.finding_id);
	}
	return { resolutions };
}
