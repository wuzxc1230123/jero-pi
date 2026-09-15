import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { assessJeroReviewRiskFromStatsV1, assessJeroReviewRiskV1 } from "../../lib/authority/risk-assess.ts";
import { decodeReviewAssessmentV1, REVIEW_ASSESSMENT_SCHEMA, VERIFICATION_TIER } from "../../lib/review-risk-assessment.ts";
import type { ReviewDiffStat } from "../../lib/review-risk.ts";
import { repository } from "./fixtures.ts";

// Spec §I.7: read-only risk assessment — tier mapping off the ported
// classifier and fail-closed-to-high on every failure mode. The produced
// envelope must decode through the PORTED decoder (shape conformance).

function stat(path: string, additions: number, deletions = 0): ReviewDiffStat {
	return { path, additions, deletions, binary: false, mode_only: false };
}

test("tier mapping: classifier low→passive, medium→medium, high→high", () => {
	const passive = assessJeroReviewRiskFromStatsV1([stat("docs/readme.md", 3)], { kind: "current-changes" });
	assert.equal(passive.risk, "passive");
	const medium = assessJeroReviewRiskFromStatsV1([stat("src/app.ts", 30)], { kind: "current-changes" });
	assert.equal(medium.risk, "medium");
	const high = assessJeroReviewRiskFromStatsV1([stat("src/auth/token.ts", 3)], { kind: "current-changes" });
	assert.equal(high.risk, "high");
	// candidate descriptor rides along, base-diff included.
	const baseDiff = assessJeroReviewRiskFromStatsV1([stat("src/app.ts", 5)], { kind: "base-diff", baseRef: "main" });
	assert.equal(baseDiff.candidate.kind, "base-diff");
	assert.equal(baseDiff.candidate.baseRef, "main");
});

test("the produced envelope decodes through the ported review-risk-assessment decoder", () => {
	const assessment = assessJeroReviewRiskFromStatsV1([stat("src/app.ts", 12, 4)], { kind: "current-changes" });
	// The wire envelope uses snake_case counts exactly as the Go binary emitted.
	const wire = { ...assessment, changed_paths: assessment.changedPaths, changed_lines: assessment.changedLines };
	const decoded = decodeReviewAssessmentV1(JSON.parse(JSON.stringify(wire)));
	assert.equal(decoded.schema, REVIEW_ASSESSMENT_SCHEMA);
	assert.equal(decoded.changedPaths, 1);
	assert.equal(decoded.changedLines, 16);
	assert.ok(decoded.reasons.length >= 1);
});

test("empty and non-executable diffs produce their own reason rows", () => {
	const empty = assessJeroReviewRiskFromStatsV1([], { kind: "current-changes" });
	assert.deepEqual(empty.reasons.map(({ code }) => code), ["empty_content"]);
	assert.equal(empty.risk, "passive");
	const docsOnly = assessJeroReviewRiskFromStatsV1([stat("docs/guide.md", 9)], { kind: "current-changes" });
	assert.equal(docsOnly.risk, "passive");
	assert.ok(docsOnly.reasons.some(({ code }) => code === "non_executable_only" || code === "executable_change"));
});

test("fail-closed-to-high: unassessable input never reports below high", (t) => {
	const unassessable = assessJeroReviewRiskFromStatsV1(
		[{ path: "!!non-canonical\\path", additions: 1, deletions: 0, binary: false, mode_only: false }],
		{ kind: "current-changes" },
	);
	assert.equal(unassessable.risk, "high");
	assert.equal(unassessable.reasons[0]?.code, "unassessable");
	// Unpaired baseRef/committedOnly fails closed to high with an unassessable reason.
	const repo = repository(t);
	mkdirSync(join(repo, "src"), { recursive: true });
	writeFileSync(join(repo, "src", "app.ts"), "export const a = 1;\n");
	const unpaired = assessJeroReviewRiskV1({ cwd: repo, baseRef: "HEAD" });
	assert.equal(unpaired.risk, "high");
	assert.equal(unpaired.reasons[0]?.code, "unassessable");
	// A non-git directory also fails closed to high.
	const outside = mkdtempSync(join(tmpdir(), "jero-not-a-repo-"));
	t.after(() => rmSync(outside, { recursive: true, force: true }));
	const nowhere = assessJeroReviewRiskV1({ cwd: outside });
	assert.equal(nowhere.risk, "high");
	assert.equal(nowhere.reasons[0]?.code, "unassessable");
});

test("workspace assessment over a live repository counts untracked files", (t) => {
	const repo = repository(t);
	mkdirSync(join(repo, "src"), { recursive: true });
	writeFileSync(join(repo, "src", "app.ts"), "export const a = 1;\n");
	const assessment = assessJeroReviewRiskV1({ cwd: repo });
	assert.equal(assessment.candidate.kind, "current-changes");
	assert.equal(assessment.changedPaths, 1);
	assert.equal(assessment.changedLines, 1);
	assert.equal(assessment.risk, "medium");
	assert.ok(assessment.reasons.length >= 1);
});

test("committed-only assessment pairs baseRef with committedOnly and reviews the range", (t) => {
	const repo = repository(t);
	const assessment = assessJeroReviewRiskV1({ cwd: repo, baseRef: "HEAD", committedOnly: true });
	assert.equal(assessment.candidate.kind, "base-diff");
	assert.equal(assessment.candidate.baseRef, "HEAD");
	// The committed range of a clean fixture repository is empty: passive.
	assert.equal(assessment.risk, "passive");
	assert.equal(assessment.changedPaths, 0);
});

test("verification tier vocabulary includes unassessable and maps the fail-closed tier", () => {
	// The ported tier table stays the verification-plan authority (gentle-pi#662);
	// risk-assess only feeds it.
	assert.equal(VERIFICATION_TIER.UNASSESSABLE, "unassessable");
	assert.equal(VERIFICATION_TIER.HIGH, "high");
});
