import { decodeJeroVerifyResultV1, type JeroVerifyResultV1 } from "./protocol.ts";

// verify-report.md 封套提取（规范 _tools/p2-m4-sdd-analysis.md §C）：
// 通向 protocol.ts（M1）持有的严格 `jero.verify-result/v1` 解码器的
// markdown/YAML 前言桥接。SDD verify 阶段把报告写成 verify-report.md
// 内部的围栏 JSON 块；提取只接受该形态——恰好一个围栏 ```json 块且
// 内容可解码为封套——别无其他。
//
// 刻意分歧（设计 §5.1.8）：上游最新 head 已退役
// gentle-ai.verify-result/v1 的证明受理；jero-pi 刻意在 jero.* 命名空间
// 下于进程内恢复该纪律。封套字段属于我们，并经 schema 评审演进，
// 而非自由形式的编辑。

export type JeroVerifyReportRefusalCode =
	| "missing-evidence"
	| "unreadable-evidence"
	| "malformed-envelope"
	| "schema-mismatch";

export type JeroVerifyReportResultV1 =
	| { readonly kind: "ok"; readonly envelope: JeroVerifyResultV1 }
	| { readonly kind: "refused"; readonly code: JeroVerifyReportRefusalCode; readonly detail: string };

const FENCED_JSON = /```json\s*\n([\s\S]*?)\n```/g;

/**
 * 从 verify-report.md 正文提取验证封套。严格：恰好一个围栏 json 块，
 * 经严格解码器解码——未知键、错误比率与非 sha256 身份都以类型化方式
 * 拒绝。
 */
export function extractJeroVerifyReportV1(text: string): JeroVerifyReportResultV1 {
	const matches = [...text.matchAll(FENCED_JSON)];
	if (matches.length === 0) return { kind: "refused", code: "malformed-envelope", detail: "verify-report carries no fenced json envelope" };
	if (matches.length > 1) return { kind: "refused", code: "malformed-envelope", detail: "verify-report carries more than one fenced json block" };
	let parsed: unknown;
	try {
		parsed = JSON.parse(matches[0]![1]!);
	} catch (error) {
		return { kind: "refused", code: "malformed-envelope", detail: error instanceof Error ? error.message : String(error) };
	}
	try {
		return { kind: "ok", envelope: decodeJeroVerifyResultV1(parsed) };
	} catch (error) {
		return { kind: "refused", code: "schema-mismatch", detail: error instanceof Error ? error.message : String(error) };
	}
}

/**
 * `passed` 结局的 settle 侧证据门（spec §C）：封套必须格式完好，且其
 * evidence_revision 必须是结算出示的身份。相对 acquire 时点的新鲜度
 * 与范围包含性属于调用方的日志化上下文（尝试台账记录
 * remediates_evidence_revision 与未跟踪三元组）；本辅助函数是 P4 封装
 * 在结算之前调用的可复用进程内检查。
 */
export function validateJeroVerifyEvidenceForSettleV1(options: { envelopeText: string; evidenceRevision: string }): JeroVerifyReportResultV1 {
	const extracted = extractJeroVerifyReportV1(options.envelopeText);
	if (extracted.kind === "refused") return extracted;
	if (extracted.envelope.evidence_revision !== options.evidenceRevision) {
		return { kind: "refused", code: "schema-mismatch", detail: `envelope evidence_revision ${extracted.envelope.evidence_revision} does not match the settlement evidence ${options.evidenceRevision}` };
	}
	return extracted;
}
