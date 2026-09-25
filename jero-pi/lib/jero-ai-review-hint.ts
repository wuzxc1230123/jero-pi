import { REVIEW_ASSESSMENT_RISK, type ReviewAssessmentV1 } from "./review-risk-assessment.ts";

// 微小候选提示：inspect 返回干净的 START 就绪状态时，工具结果附加的
// 一条建议性字段。阈值刻意保守——只有权威风险评估器判为 passive
// （空候选或纯文档变更）且 authored 变更行数极小才提示；medium/high
// 一律不提示。提示永远只是信息：START 与否仍是调用方与用户的决定，
// 该字段不参与任何状态转移，也不是权威输出的一部分。

export const TRIVIAL_REVIEW_CHANGED_LINES = 10;

export interface ReviewTrivialityHint {
	readonly changed_lines: number;
	readonly risk: string;
	readonly advice: string;
}

export function reviewTrivialityHint(assessment: ReviewAssessmentV1): ReviewTrivialityHint | undefined {
	if (assessment.risk !== REVIEW_ASSESSMENT_RISK.PASSIVE || assessment.changedLines > TRIVIAL_REVIEW_CHANGED_LINES) return undefined;
	return Object.freeze({
		changed_lines: assessment.changedLines,
		risk: assessment.risk,
		advice: "This candidate is trivial (passive risk classification with few authored changed lines). Consider asking the user whether the full review lifecycle is warranted; the read-only {\"operation\":\"assess\"} plan is the lightweight alternative. START remains the caller's decision.",
	});
}
