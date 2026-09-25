import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import test from "node:test";

import { createJeroAiExtension } from "../extensions/jero-ai.ts";
import type { NativeReviewCli } from "../lib/authority/client-contract.ts";
import { reviewTrivialityHint, TRIVIAL_REVIEW_CHANGED_LINES } from "../lib/jero-ai-review-hint.ts";
import { REVIEW_ASSESSMENT_RISK } from "../lib/review-risk-assessment.ts";
import { cleanWorkspaceStatus, reviewRepository, type ReviewStartRepository } from "./jero-ai-shared.ts";

// ---------------------------------------------------------------------------
// 纯逻辑：提示的保守阈值
// ---------------------------------------------------------------------------

function assessment(risk: string, changedLines: number): Parameters<typeof reviewTrivialityHint>[0] {
	return {
		schema: "test", risk,
		reasons: [], changedPaths: 0, changedLines,
		candidate: { kind: "current-changes" },
	} as unknown as Parameters<typeof reviewTrivialityHint>[0];
}

test("the hint fires only for passive candidates at or below the trivial line budget", () => {
	const passive = reviewTrivialityHint(assessment(REVIEW_ASSESSMENT_RISK.PASSIVE, 3));
	assert.ok(passive);
	assert.equal(passive!.changed_lines, 3);
	assert.equal(passive!.risk, "passive");
	assert.match(passive!.advice, /"operation":"assess"/);

	assert.equal(reviewTrivialityHint(assessment(REVIEW_ASSESSMENT_RISK.PASSIVE, TRIVIAL_REVIEW_CHANGED_LINES + 1)), undefined, "anything above the budget is not trivial");
	assert.equal(reviewTrivialityHint(assessment(REVIEW_ASSESSMENT_RISK.MEDIUM, 1)), undefined, "medium is never trivial");
	assert.equal(reviewTrivialityHint(assessment(REVIEW_ASSESSMENT_RISK.HIGH, 1)), undefined, "high is never trivial");
});

// ---------------------------------------------------------------------------
// 扩展接线：inspect ready 时经真实 git 仓库附加提示
// ---------------------------------------------------------------------------

function toolHarness(reviewRepositoryCwd: string, targetStatus: () => unknown) {
	const tools = new Map<string, any>();
	const pi = {
		on() {},
		registerCommand() {},
		registerFlag() {},
		registerTool(tool: { name: string }) {
			tools.set(tool.name, tool);
		},
	} as unknown as ExtensionAPI;
	createJeroAiExtension({
		nativeReviewCli: { targetStatus: async () => targetStatus() } as unknown as NativeReviewCli,
	})(pi);
	const executeInspect = async (cwd: string) => {
		const result = await tools.get("jero_review")!.execute("id-1", { operation: "inspect" }, undefined, undefined, {
			cwd,
			sessionManager: { getSessionId: () => "session-1" },
		});
		return result.details;
	};
	return { executeInspect, cwd: reviewRepositoryCwd };
}

test("inspect on a clean ready slate appends the triviality hint", async (t) => {
	const repo: ReviewStartRepository = reviewRepository(t);
	const { executeInspect, cwd } = toolHarness(repo.cwd, () => cleanWorkspaceStatus(repo.baseTree));
	const details = await executeInspect(cwd);
	assert.equal(details.status, "ready");
	const hint = details.triviality_hint as { changed_lines: number; risk: string } | undefined;
	assert.ok(hint, "a clean worktree is the trivial case and must carry the hint");
	assert.equal(hint!.changed_lines, 0);
	assert.equal(hint!.risk, "passive");
});

test("inspect stays hint-free when the working tree carries a real code change", async (t) => {
	const repo: ReviewStartRepository = reviewRepository(t);
	writeFileSync(join(repo.cwd, "app.ts"), "export const value = 42;\n");
	execFileSync("git", ["add", "app.ts"], { cwd: repo.cwd, stdio: "ignore" });
	const { executeInspect, cwd } = toolHarness(repo.cwd, () => cleanWorkspaceStatus(repo.baseTree));
	const details = await executeInspect(cwd);
	assert.equal(details.status, "ready");
	assert.equal(details.triviality_hint, undefined, "a staged code change is at least medium risk; no hint may appear");
});
