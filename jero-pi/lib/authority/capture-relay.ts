import { readFileSync } from "node:fs";
import { sha256Hex } from "../review-canonical.ts";
import { join } from "node:path";
import { resolveJeroAuthorityContextV1, type JeroAuthorityContextV1 } from "./review.ts";
import { renderJeroCaptureBindingV1, decodeJeroReviewerResultEnvelopeV1, type JeroCaptureSlotV1 } from "./capture.ts";
import type { JeroLensName } from "./protocol.ts";
import type { JeroFindingClassificationSubmissionV1, JeroLensResultSubmissionV1 } from "./finalize.ts";
import { admitJeroReviewerResultV1 } from "./result-artifacts.ts";
import { capturedJeroArtifactsCompleteV1, jeroReviewerResultsDirectoryV1 } from "./result-artifacts.ts";
import { decodeJeroRefuterResolutionsV1, decodeJeroReviewerResultEnvelopeV1 as _unusedEnvelope } from "./capture.ts";
import { pendingRefuterRequestHashV1, type JeroReviewFinalizeInputV1 } from "./finalize.ts";
import { reviewFinalizeV1 } from "./finalize.ts";
import { reviewValidateV1 } from "./validate.ts";
import { buildJeroLastEventClosureV1, jeroAdvisoryFindingsFromStateV1, JERO_CAPTURE_CLOSURE_OPERATIONS } from "./closures.ts";

// P4b（设计 §5.1.4、M3 规范 §I.7）：把进程内权威注入 Pi 宿主中继的
// 生产组合胶水——
//
//   STATUS(collect) → renderBinding → 中继 prepare（锁定的 pi 子进程）
//                  → 中继 submit（进程内受理）
//
// `renderJeroCaptureSlotForRelayV1` 把提供方签发的绑定令牌解析回类型化
// 捕获槽并渲染提示词字节（不派发进程）；`admitJeroCaptureResultForRelayV1`
// 读取以 0o600 暂存的结果文件，并让评审封套通过权威受理（M3 的产物 +
// CAS + 冻结台账纪律）。权威的类型化拒绝以中继文档化的
// `[invalid_request]` 标记呈现（Mi7 契约），使中继将其归类为已证明的
// 非变更。

const BINDING_TOKEN = /^--([a-z-]+)=(.*)$/;
const LENS_NAMES: readonly string[] = ["review-risk", "review-resilience", "review-readability", "review-reliability"];

interface ParsedCaptureTokens {
	lineage: string | undefined;
	expectedRevision: string | undefined;
	target: string | undefined;
	lens: string | undefined;
	order: number | undefined;
	subjectHash: string | undefined;
	repositoryContext: string | undefined;
}

function parseCaptureTokensV1(tokens: readonly string[]): ParsedCaptureTokens {
	const parsed: ParsedCaptureTokens = { lineage: undefined, expectedRevision: undefined, target: undefined, lens: undefined, order: undefined, subjectHash: undefined, repositoryContext: undefined };
	for (const token of tokens) {
		const match = BINDING_TOKEN.exec(token);
		if (match === null) continue;
		const [, name, value] = match;
		switch (name) {
			case "lineage": parsed.lineage = value; break;
			case "expected-revision": parsed.expectedRevision = value; break;
			case "target": parsed.target = value; break;
			case "lens": parsed.lens = value; break;
			case "order": {
				const order = Number(value);
				if (Number.isSafeInteger(order) && order >= 0) parsed.order = order;
				break;
			}
			case "subject-hash": parsed.subjectHash = value; break;
			case "repository-context": parsed.repositoryContext = value; break;
			default: break;
		}
	}
	return parsed;
}

function contextForRelayV1(cwd: string | undefined): JeroAuthorityContextV1 {
	if (cwd === undefined || cwd.length === 0) throw new Error("capture relay requires the request's target cwd");
	const resolution = resolveJeroAuthorityContextV1(cwd);
	if (resolution.kind !== "ok") throw new Error(`[invalid_request] authority resolution refused: ${resolution.code}${resolution.detail === undefined ? "" : ` (${resolution.detail})`}`);
	return resolution.context;
}

/**
 * 渲染接缝（Mi7 契约适用于拒绝）：解析绑定令牌，从血脉记录（绝不从
 * 令牌）重新推导槽位，并在请求绑定已偏离权威可提供的内容时以
 * `[invalid_request]` 拒绝——过期的修订号、外来评审视角和不匹配的
 * 主题摘要绝不进入评审进程。
 */
export async function renderJeroCaptureSlotForRelayV1(request: { readonly captureArgumentTokens: readonly string[]; readonly targetCwd?: string }): Promise<{ promptBytes: Buffer }> {
	const tokens = parseCaptureTokensV1(request.captureArgumentTokens);
	if (tokens.lineage === undefined || tokens.lens === undefined || tokens.order === undefined || tokens.subjectHash === undefined) {
		throw new Error("[invalid_request] capture relay binding is missing lineage, lens, order, or subject-hash");
	}
	if (!LENS_NAMES.includes(tokens.lens)) throw new Error(`[invalid_request] capture relay lens ${JSON.stringify(tokens.lens)} is not an ordinary lens`);
	const context = contextForRelayV1(request.targetCwd);
	const slot: JeroCaptureSlotV1 = { kind: "reviewer", context, lineageId: tokens.lineage, lens: tokens.lens as JeroLensName, selectedOrder: tokens.order };
	const rendered = renderJeroCaptureBindingV1(slot);
	if (rendered.kind === "refused") {
		throw new Error(`[invalid_request] capture rendering refused: ${rendered.code}${rendered.detail === undefined ? "" : ` (${rendered.detail})`}`);
	}
	if (rendered.promptBytes === undefined || rendered.promptBytes.length === 0) throw new Error("[invalid_request] capture rendering produced no reviewer bytes");
	// 绑定漂移检查：渲染头部派生自记录；请求令牌必须与之相符
	// （过期的 expected-revision 是最常见的漂移）。评审视角/序号相等是
	// 结构性的；下面的修订号检查使用渲染槽位的预期契约。
	const record = context.lineages.load(tokens.lineage);
	if (record.kind === "ok" && tokens.expectedRevision !== undefined && record.record.revision !== tokens.expectedRevision) {
		throw new Error(`[invalid_request] capture binding revision ${tokens.expectedRevision} drifted from the authority revision ${record.record.revision}`);
	}
	return { promptBytes: rendered.promptBytes };
}

/**
 * 受理接缝：逐字读取暂存的结果文件，严格解码评审封套，并经权威
 * 受理（sha256 重算、主题/序号重绑、产物 + CAS 持久化）。返回已受理
 * 产物的权威 JSON——即中继的不透明提交字符串。
 */
// Q-A（见 _tools/p4-f-g-capture-maintenance-analysis.md）：产物集完成
// 组合。受理最后一个提供的评审视角产物就是旧二进制的原子捕获结果
// 提交边界——冻结与证据分类都搭载其中。分类行从已受理的封套行
// 确定性派生（evidence_class 即类别枚举；proof_refs 连接成具体证据），
// 因此该组合不需要评审员已宣誓内容之外的任何模型输出。它在 classify
// 之后停止：修正计划、refuter 与最终验证仍由各自的向量驱动。
function composeCapturedResultsFinalizeV1(context: import("./review.ts").JeroAuthorityContextV1, cwd: string | undefined, lineageId: string): Record<string, unknown> | undefined {
	const loaded = context.lineages.load(lineageId);
	if (loaded.kind !== "ok") return { kind: "refused", code: "lineage-unreadable", detail: loaded.kind };
	const record = loaded.record;
	const completion = capturedJeroArtifactsCompleteV1(context, record);
	if (!completion.complete) return undefined;
	const lensResults: JeroLensResultSubmissionV1[] = [];
	const classifications: JeroFindingClassificationSubmissionV1[] = [];
	for (const artifact of completion.artifacts.toSorted((a, b) => a.selected_order - b.selected_order)) {
		// 受理总是把逐字字节暂存在评审员结果目录中；清单的定位符
		// （path 还是 reference）只记录权威引用它的方式，因此读取权威的
		// 暂存文件。
		const staged = join(jeroReviewerResultsDirectoryV1(context.store.store_root, lineageId), `${String(artifact.selected_order).padStart(2, "0")}-${artifact.lens}.json`);
		let source: Buffer;
		try {
			source = readFileSync(staged);
		} catch (error) {
			return { kind: "refused", code: "artifact-unreadable", detail: `${artifact.lens}: ${error instanceof Error ? error.message : String(error)}` };
		}
		try {
			const envelope = decodeJeroReviewerResultEnvelopeV1(JSON.parse(source.toString("utf8")));
			for (const result of envelope.review_result.lens_results) {
				lensResults.push({ lens: result.lens, findings: result.findings.map((finding) => ({ id: finding.id, location: finding.location, severity: finding.severity, claim: finding.claim, proof_refs: [...finding.proof_refs] })), evidence: [...result.evidence] });
				for (const finding of result.findings) {
					classifications.push({ finding_id: finding.id, class: finding.evidence_class, proof: finding.proof_refs.join("; "), causal_disposition: finding.causal_disposition });
				}
			}
		} catch (error) {
			return { kind: "refused", code: "artifact-undecodable", detail: error instanceof Error ? error.message : String(error) };
		}
	}
	const frozen = reviewFinalizeV1(context, { cwd: cwd ?? "", lineageId, reviewer_run_acknowledged: true, review_result: { lens_results: lensResults } });
	if (frozen.kind === "refused") return { kind: "refused", code: frozen.code, detail: frozen.detail };
	if (frozen.kind !== "frozen") return { kind: "unexpected", got: frozen.kind };
	const resolved = reviewFinalizeV1(context, { cwd: cwd ?? "", lineageId, classifications });
	if (resolved.kind === "refused") return { kind: "refused", code: resolved.code, detail: resolved.detail };
	if (resolved.kind === "evidence_resolved" && resolved.fix_finding_ids.length === 0) {
		// Q-A2：干净路径径直通过最终验证——最终证据就是评审员宣誓过的
		// 范围证据（在 FINALIZE 时哈希，从不在 START 时），正是旧二进制
		// 拥有的边界。
		const finalEvidence = lensResults.flatMap((row) => [...row.evidence]).join("\n")
		const terminal = reviewFinalizeV1(context, { cwd: cwd ?? "", lineageId, final_evidence: finalEvidence, final_verification_passed: true });
		if (terminal.kind === "refused") return { kind: "refused", code: terminal.code, detail: terminal.detail };
		if (terminal.kind !== "terminal") return { kind: "unexpected", got: terminal.kind };
		return closureSubmissionV1(context, cwd, lineageId, terminal.state);
	}
	if (resolved.kind === "terminal") return closureSubmissionV1(context, cwd, lineageId, resolved.state);
	return { kind: "composed", state: resolved.state, fix_finding_ids: resolved.kind === "evidence_resolved" ? [...resolved.fix_finding_ids] : undefined };
}

// 终局闭包随提交逐字搭载：扩展从中继结果解码
// gentle-ai.review-last-event-closure/v1 正文（snake 键），因此 jero 闭包
// 只需换掉 schema 字符串。
function closureSubmissionV1(context: import("./review.ts").JeroAuthorityContextV1, cwd: string | undefined, lineageId: string, state: "approved" | "escalated"): Record<string, unknown> | undefined {
	const loaded = context.lineages.load(lineageId);
	if (loaded.kind !== "ok") return { kind: "refused", code: "lineage-unreadable", detail: loaded.kind };
	const closure = buildJeroLastEventClosureV1({
		operation: JERO_CAPTURE_CLOSURE_OPERATIONS.CAPTURE_RESULT,
		record: loaded.record,
		state,
		cwd,
		...(state === "approved" ? { advisoryFindings: jeroAdvisoryFindingsFromStateV1(loaded.record.state) } : {}),
	});
	// 线上词汇差异 #2：fixture 词汇用斜杠命名两个闭包操作
	// （review/capture-result、review/capture-validation），另两个用点；
	// jero 构建器是统一的。
	const wireOperation = closure.operation === "review.capture-result" ? "review/capture-result" : closure.operation === "review.capture-validation" ? "review/capture-validation" : closure.operation;
	return { kind: "closure", closure_json: JSON.stringify({ ...closure, schema: "gentle-ai.review-last-event-closure/v1", operation: wireOperation }) };
}

export async function admitJeroCaptureResultForRelayV1(request: { readonly captureArgumentTokens: readonly string[]; readonly targetCwd?: string }, operationToken: string, submitTokens: readonly string[], resultFile: string): Promise<string> {
	if (operationToken !== "capture-result") {
		throw new Error(`[invalid_request] the in-process admission supports capture-result, not ${JSON.stringify(operationToken)}`);
	}
	// 提交令牌在 {{value}} 槽位携带被替换的结果文件；绑定令牌
	// （去掉该值）仍可解析出 lineage/lens/order。
	const bindingTokens = [...request.captureArgumentTokens, ...submitTokens.filter((token) => !token.includes("result.raw"))];
	const tokens = parseCaptureTokensV1(bindingTokens);
	if (tokens.lineage === undefined || tokens.lens === undefined || tokens.order === undefined || tokens.subjectHash === undefined) {
		throw new Error("[invalid_request] capture admission binding is missing lineage, lens, order, or subject-hash");
	}
	const context = contextForRelayV1(request.targetCwd);
	const raw = readFileSync(resultFile);
	decodeJeroReviewerResultEnvelopeV1(JSON.parse(raw.toString("utf8")));
	try {
		const admitted = admitJeroReviewerResultV1(context, {
			lineageId: tokens.lineage,
			lens: tokens.lens as JeroLensName,
			selectedOrder: tokens.order,
			subjectHash: tokens.subjectHash,
			rawResultBytes: raw,
			locator: tokens.repositoryContext === undefined ? "path" : "reference",
		});
		if (admitted.kind === "refused") {
			throw new Error(`[invalid_request] capture admission refused: ${admitted.code}${admitted.detail === undefined ? "" : ` (${admitted.detail})`}`);
		}
		// 当本次受理补全产物集时，已受理的清单搭载完成组合——扩展无论
		// 如何都会消费产物清单，组合结果只是诚实的诊断信息（拒绝绝不
		// 撤销已受理的产物）。
		const composition = admitted.replayed ? undefined : composeCapturedResultsFinalizeV1(context, request.targetCwd, tokens.lineage);
		if (composition !== undefined && composition.kind === "closure") return String(composition.closure_json);
		return JSON.stringify({ ...admitted.artifact, ...(composition === undefined ? {} : { finalize_composition: composition }) });
	} catch (error) {
		if (error instanceof Error && error.message.includes("[invalid_request]")) throw error;
		// 受理纪律失败（sha 不匹配、重绑漂移、状态守卫）是已证明的非变更：
		// 槽位未被消费。
		throw new Error(`[invalid_request] capture admission failed: ${error instanceof Error ? error.message : String(error)}`);
	}
}

// ---------------------------------------------------------------------------
// Q-B：提供方角色向量（refuter / 定向 validator）。中继组合镜像评审员
// 接缝对：render 从血脉记录（绝非从令牌）重新推导槽位；admit 执行该
// 角色的权威转移链，并在捕获终结评审时以 last-event 闭包作答，否则
// 返回产物清单。
// ---------------------------------------------------------------------------

export type JeroProviderRoleV1 = "refuter" | "validator";

function roleSlotForV1(role: JeroProviderRoleV1, context: import("./review.ts").JeroAuthorityContextV1, lineageId: string): import("./capture.ts").JeroCaptureSlotV1 {
	return role === "refuter" ? { kind: "refuter-vector", context, lineageId } : { kind: "validator-vector", context, lineageId };
}

export async function renderJeroProviderRoleSlotForRelayV1(request: { readonly captureArgumentTokens: readonly string[]; readonly targetCwd?: string }, role: JeroProviderRoleV1): Promise<{ promptBytes: Buffer }> {
	const tokens = parseCaptureTokensV1(request.captureArgumentTokens);
	if (tokens.lineage === undefined) throw new Error("[invalid_request] the role binding is missing its lineage token");
	const context = contextForRelayV1(request.targetCwd);
	const rendered = renderJeroCaptureBindingV1(roleSlotForV1(role, context, tokens.lineage));
	if (rendered.kind === "refused") throw new Error(`[invalid_request] role rendering refused: ${rendered.code}${rendered.detail === undefined ? "" : ` (${rendered.detail})`}`);
	if (rendered.promptBytes === undefined || rendered.promptBytes.length === 0) throw new Error("[invalid_request] role rendering produced no bytes");
	const record = context.lineages.load(tokens.lineage);
	if (record.kind === "ok" && tokens.expectedRevision !== undefined && record.record.revision !== tokens.expectedRevision) {
		throw new Error(`[invalid_request] role binding revision ${tokens.expectedRevision} drifted from the authority revision ${record.record.revision}`);
	}
	return { promptBytes: rendered.promptBytes };
}

function wireClosureSubmissionV1(context: import("./review.ts").JeroAuthorityContextV1, cwd: string | undefined, lineageId: string, operation: "review.capture-refuter" | "review.capture-validation", state: "approved" | "correction_required" | "escalated"): string {
	const loaded = context.lineages.load(lineageId);
	if (loaded.kind !== "ok") throw new Error(`[invalid_request] the closure could not reload lineage ${lineageId} (${loaded.kind})`);
	const closure = buildJeroLastEventClosureV1({
		operation,
		record: loaded.record,
		state,
		cwd,
		...(state === "approved" ? { advisoryFindings: jeroAdvisoryFindingsFromStateV1(loaded.record.state) } : {}),
	});
	const wireOperation = operation === "review.capture-validation" ? "review/capture-validation" : operation;
	return JSON.stringify({ ...closure, schema: "gentle-ai.review-last-event-closure/v1", operation: wireOperation });
}

export async function admitJeroProviderRoleResultForRelayV1(request: { readonly captureArgumentTokens: readonly string[]; readonly targetCwd?: string }, operationToken: string, submitTokens: readonly string[], resultFile: string, role: JeroProviderRoleV1): Promise<string> {
	if (operationToken !== "capture-refuter" && operationToken !== "capture-validation") {
		throw new Error(`[invalid_request] the role admission supports capture-refuter/capture-validation, not ${JSON.stringify(operationToken)}`);
	}
	const tokens = parseCaptureTokensV1([...request.captureArgumentTokens, ...submitTokens.filter((token) => !token.includes("result.raw"))]);
	if (tokens.lineage === undefined) throw new Error("[invalid_request] the role admission binding is missing its lineage");
	const context = contextForRelayV1(request.targetCwd);
	const cwd = request.targetCwd;
	const raw = readFileSync(resultFile);
	if (role === "refuter") {
		return admitRefuterResolutionV1(context, cwd, tokens.lineage, raw);
	}
	return admitValidatorAnswerV1(context, cwd, tokens.lineage, raw);
}

function admitRefuterResolutionV1(context: import("./review.ts").JeroAuthorityContextV1, cwd: string | undefined, lineageId: string, raw: Buffer): string {
	const body = JSON.parse(raw.toString("utf8")) as { resolutions?: unknown };
	const resolutions = decodeJeroRefuterResolutionsV1({ resolutions: body.resolutions }).resolutions;
	const loaded = context.lineages.load(lineageId);
	if (loaded.kind !== "ok") throw new Error(`[invalid_request] the refuter admission could not reload lineage (${loaded.kind})`);
	// 批次重放它签发时所依据的完全相同的分类（持久化的状态行），
	// 与旧封装的第二次调用完全一致。
	const replayedClassifications = Object.values(loaded.record.state.classifications).map((row) => ({ finding_id: row.finding_id, class: row.class, proof: row.proof, ...(row.causal_disposition === undefined ? {} : { causal_disposition: row.causal_disposition }) }));
	const resolved = reviewFinalizeV1(context, { cwd: cwd ?? "", lineageId, classifications: replayedClassifications, refuter_batch: { request_hash: pendingRefuterRequestHashV1(loaded.record.state.pending_refuter_ids), resolutions: resolutions.map((row) => ({ finding_id: row.finding_id, outcome: row.outcome, proof: row.proof })) } });
	if (resolved.kind === "refused") throw new Error(`[invalid_request] refuter admission refused: ${resolved.code}${resolved.detail === undefined ? "" : ` (${resolved.detail})`}`);
	if (resolved.kind === "evidence_resolved" && resolved.fix_finding_ids.length === 0) {
		const terminal = reviewFinalizeV1(context, { cwd: cwd ?? "", lineageId, final_evidence: resolutions.map((row) => row.proof).join("\n"), final_verification_passed: true });
		if (terminal.kind === "terminal") return wireClosureSubmissionV1(context, cwd, lineageId, "review.capture-refuter", terminal.state);
		throw new Error(`[invalid_request] the refuted review did not close (${terminal.kind})`);
	}
	if (resolved.kind === "evidence_resolved") return wireClosureSubmissionV1(context, cwd, lineageId, "review.capture-refuter", "correction_required");
	if (resolved.kind === "terminal") return wireClosureSubmissionV1(context, cwd, lineageId, "review.capture-refuter", resolved.state);
	return JSON.stringify({ kind: "composed", state: resolved.state, got: resolved.kind });
}

function admitValidatorAnswerV1(context: import("./review.ts").JeroAuthorityContextV1, cwd: string | undefined, lineageId: string, raw: Buffer): string {
	// 答案形态即渲染契约的 JSON：request_hash、correction_ids、
	// original_criteria{passed,evidence}、correction_regression
	// {passed,evidence}、fix_caused_findings、follow_ups。
	const answer = JSON.parse(raw.toString("utf8")) as { request_hash?: unknown; correction_ids?: unknown; original_criteria?: { passed?: unknown; evidence?: unknown }; correction_regression?: { passed?: unknown; evidence?: unknown } };
	if (typeof answer.request_hash !== "string" || !Array.isArray(answer.correction_ids) || typeof answer.original_criteria?.passed !== "boolean" || !Array.isArray(answer.original_criteria.evidence) || typeof answer.correction_regression?.passed !== "boolean" || !Array.isArray(answer.correction_regression.evidence)) {
		throw new Error("[invalid_request] the validator answer does not carry the rendered contract shape");
	}
	const validated = reviewValidateV1(context, {
		cwd: cwd ?? "",
		lineageId,
		evidence: {
			outcome: answer.correction_regression.passed ? "passed" as const : "verification_failed" as const,
			evidenceIdentity: `sha256:${sha256Hex(raw)}`,
			recordDigest: answer.request_hash,
		},
		validation: {
			request_hash: answer.request_hash.replace(/^sha256:/, ""),
			correction_ids: answer.correction_ids as string[],
			original_criteria: { passed: answer.original_criteria.passed, evidence: answer.original_criteria.evidence as string[] },
			correction_regression: { passed: answer.correction_regression.passed, evidence: answer.correction_regression.evidence as string[] },
			fix_caused_findings: [],
			follow_ups: [],
		},
	});
	if (validated.kind === "refused") throw new Error(`[invalid_request] validation admission refused: ${validated.code}${validated.detail === undefined ? "" : ` (${validated.detail})`}`);
	if (validated.kind === "recapture_required") return JSON.stringify({ kind: "recapture_required", supersedes: validated.supersedes, guidance: validated.guidance });
	// validated：定向验证已通过——最终验证将其闭合。
	const terminal = reviewFinalizeV1(context, { cwd: cwd ?? "", lineageId, final_evidence: [...(answer.original_criteria.evidence as string[]), ...(answer.correction_regression.evidence as string[])].join("\n"), final_verification_passed: true });
	if (terminal.kind === "terminal") return wireClosureSubmissionV1(context, cwd, lineageId, "review.capture-validation", terminal.state);
	throw new Error(`[invalid_request] the validated review did not close (${terminal.kind})`);
}
