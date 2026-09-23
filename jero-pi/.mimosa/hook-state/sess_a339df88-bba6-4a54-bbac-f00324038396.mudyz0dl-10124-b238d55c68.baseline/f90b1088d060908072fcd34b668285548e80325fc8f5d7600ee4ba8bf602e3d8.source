import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { classifyReviewRisk, countAuthoredChangedLines, type ReviewDiffStat } from "../review-risk.ts";
import { REVIEW_ASSESSMENT_SCHEMA, REVIEW_ASSESSMENT_RISK, type ReviewAssessmentV1, type ReviewAssessmentCandidateKind } from "../review-risk-assessment.ts";
import { reviewGitEnvironment } from "../review-repository.ts";

// `authority.risk.assess`（spec §I.7）：对活动 diff 的只读风险评估，
// 复用移植的 review-risk.ts 分类（层级表、authored 行计数、金样排除）
// 与移植的 review-risk-assessment.ts 解码/层级表。上游在 Go 中计算
// 它；失败或无法识别的评估“始终”保守失败到 high（review-risk-
// assessment.ts :13-16 纪律），绝不降到更低层级。

export interface JeroRiskAssessRequestV1 {
	readonly cwd: string;
	/** 与 START 一样要求 `committedOnly` 确认（spec §B.1 配对）。 */
	readonly baseRef?: string;
	readonly committedOnly?: boolean;
}

function runGit(cwd: string, args: readonly string[]): string {
	return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env: reviewGitEnvironment() }).trim();
}

function parseNumstat(value: string): ReviewDiffStat[] {
	const stats: ReviewDiffStat[] = [];
	for (const line of value.split(/\r?\n/)) {
		if (line.length === 0) continue;
		const [added, deleted, path] = line.split("\t");
		if (path === undefined) continue;
		const binary = added === "-" || deleted === "-";
		const additions = binary ? 0 : Number.parseInt(added ?? "", 10);
		const deletions = binary ? 0 : Number.parseInt(deleted ?? "", 10);
		if (!Number.isSafeInteger(additions) || !Number.isSafeInteger(deletions)) continue;
		stats.push({ path, additions, deletions, binary, mode_only: additions + deletions === 0 });
	}
	return stats;
}

function unassessable(detail: string, candidateKind: ReviewAssessmentCandidateKind, baseRef: string | undefined): ReviewAssessmentV1 {
	return Object.freeze({
		schema: REVIEW_ASSESSMENT_SCHEMA,
		risk: REVIEW_ASSESSMENT_RISK.HIGH,
		reasons: Object.freeze([{ code: "unassessable", path: "", detail }]),
		changedPaths: 0,
		changedLines: 0,
		candidate: Object.freeze({ kind: candidateKind, baseRef }),
	});
}

/** 层级映射：分类器 low→passive、medium→medium、high→high；任何失败 → high（保守失败）。 */
export function assessJeroReviewRiskFromStatsV1(stats: readonly ReviewDiffStat[], candidate: { kind: ReviewAssessmentCandidateKind; baseRef?: string }): ReviewAssessmentV1 {
	try {
		const classification = classifyReviewRisk(stats);
		const risk = classification.tier === "low" ? REVIEW_ASSESSMENT_RISK.PASSIVE : classification.tier === "medium" ? REVIEW_ASSESSMENT_RISK.MEDIUM : REVIEW_ASSESSMENT_RISK.HIGH;
		const reasons = stats
			.filter((stat) => !stat.binary && !stat.mode_only)
			.map((stat) => ({
				code: classification.tier === "high" ? "hot_path" : "executable_change",
				path: stat.path,
				detail: classification.tier === "high"
					? `${stat.additions + stat.deletions} authored lines in ${stat.path} under a high-risk classification`
					: `${stat.additions + stat.deletions} authored lines changed in ${stat.path}`,
			}));
		if (reasons.length === 0) {
			reasons.push({ code: stats.length === 0 ? "empty_content" : "non_executable_only", path: "", detail: stats.length === 0 ? "no changed paths" : "only non-executable content changed" });
		}
		return Object.freeze({
			schema: REVIEW_ASSESSMENT_SCHEMA,
			risk,
			reasons: Object.freeze(reasons),
			changedPaths: stats.length,
			changedLines: countAuthoredChangedLines(stats),
			candidate: Object.freeze({ kind: candidate.kind, baseRef: candidate.baseRef }),
		});
	} catch {
		return unassessable("the diff could not be classified; the candidate is treated as high risk", candidate.kind, candidate.baseRef);
	}
}

/**
 * 只读的 `assess`（设计 §5.1.1 的 `authority.risk.assess(diff)`）。每种
 * 失败——配对错误、Git 失败、无法分类的 diff——都产生风险为 `high` 的
 * `gentle-ai.review-assessment/v1` 形态（P5 改名前容忍该 schema
 * 字符串，spec §H）。
 */
export function assessJeroReviewRiskV1(request: JeroRiskAssessRequestV1): ReviewAssessmentV1 {
	const candidateKind: ReviewAssessmentCandidateKind = request.baseRef !== undefined && request.committedOnly === true ? "base-diff" : "current-changes";
	if ((request.baseRef !== undefined) !== (request.committedOnly === true)) {
		return unassessable("baseRef and committedOnly must be paired; the candidate is treated as high risk", candidateKind, request.baseRef);
	}
	try {
		const stats = request.committedOnly === true
			? parseNumstat(runGit(request.cwd, ["diff", "--numstat", "--no-renames", `${request.baseRef}^{tree}`, "HEAD^{tree}"]))
			: parseNumstat(runGit(request.cwd, ["diff", "--numstat", "--no-renames", "HEAD", "--"]));
		if (request.committedOnly !== true) {
			// 工作区评估还必须计入未跟踪文件，`diff HEAD --` 会漏掉它们；
			// 每个按只新增的统计行计入。
			const untracked = runGit(request.cwd, ["ls-files", "--others", "--exclude-standard", "-z"]).split("\0").filter(Boolean);
			for (const path of untracked) {
				try {
					const bytes = readFileSync(join(request.cwd, ...path.split("/")));
					if (bytes.includes(0)) {
						stats.push({ path, additions: 0, deletions: 0, binary: true, mode_only: false });
						continue;
					}
					const text = bytes.toString("utf8");
					const lines = text.length === 0 ? 0 : text.split("\n").length - (text.endsWith("\n") ? 1 : 0);
					stats.push({ path, additions: lines, deletions: 0, binary: false, mode_only: false });
				} catch {
					stats.push({ path, additions: 0, deletions: 0, binary: true, mode_only: false });
				}
			}
		}
		return assessJeroReviewRiskFromStatsV1(stats, { kind: candidateKind, ...(request.baseRef === undefined ? {} : { baseRef: request.baseRef }) });
	} catch {
		return unassessable("the candidate could not be assessed; the host treats this as high risk", candidateKind, request.baseRef);
	}
}
