import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { createJeroAuthorityReviewCli } from "../../lib/jero-authority-cli.ts";
import { reviewStartV1 } from "../../lib/authority/start.ts";
import { reviewStatusV1 } from "../../lib/authority/status.ts";
import { reviewFinalizeV1 } from "../../lib/authority/finalize.ts";
import { startCreatedReview, admitFixtureReviewerResults, type ReviewHarnessV1 } from "./fixtures.ts";
import { Buffer } from "node:buffer";

// Q-B: the provider role vectors over the in-process adapter — the refuter
// resolution and the targeted validator both compose render → locked reviewer
// (injected here; the locked pi child in production) → admit, and the admit
// answers with the last-event closure when the capture ends the review. The
// validation role additionally derives the bounded-edit application from the
// live worktree before the validator runs.

type Harness = ReviewHarnessV1 & { start: Extract<ReturnType<typeof reviewStartV1>, { kind: "created" | "closed" }> };

function cliWith(fake: (promptBytes: Buffer) => Buffer) {
	return createJeroAuthorityReviewCli({
		providerRoleReviewer: async (promptBytes: Buffer) => {
			const stdout = fake(promptBytes);
			return { stdout, promptByteLength: promptBytes.length, stdoutByteLength: stdout.length };
		},
	});
}

function driveToFrozen(t: { after(fn: () => void): void }, evidenceClass: "deterministic" | "inferential"): Harness {
	const harness = startCreatedReview(t, "medium", 4);
	const result = { lens_results: [{ lens: "review-readability" as const, findings: [{ id: "READ-001", severity: "CRITICAL" as const, claim: "opaque claim" }], evidence: ["scope-reviewed evidence"] }] };
	admitFixtureReviewerResults(harness, harness.start.lineage_id, result);
	const frozen = reviewFinalizeV1(harness.context, { cwd: harness.repo, lineageId: harness.start.lineage_id, reviewer_run_acknowledged: true, review_result: result });
	if (frozen.kind !== "frozen") throw new Error(JSON.stringify(frozen));
	const resolved = reviewFinalizeV1(harness.context, { cwd: harness.repo, lineageId: harness.start.lineage_id, classifications: [{ finding_id: "READ-001", class: evidenceClass, proof: "classification proof", causal_disposition: "introduced" }] });
	if (evidenceClass === "deterministic" && resolved.kind !== "evidence_resolved") throw new Error(JSON.stringify(resolved));
	if (evidenceClass === "inferential" && resolved.kind !== "refuter_required") throw new Error(JSON.stringify(resolved));
	return harness;
}

function collectInputFor(harness: Harness, operation: string): { arguments: readonly { token: string }[]; validationRequest?: Record<string, unknown> } {
	const status = reviewStatusV1(harness.context, { cwd: harness.repo, lineageId: harness.start.lineage_id });
	if (status.kind !== "status") throw new Error("status failed");
	const input = status.next_transition?.collect?.inputs.find((row) => row.capture_operation === operation);
	if (input === undefined) throw new Error(`STATUS does not offer ${operation} (${status.next_transition?.reason_code})`);
	return { arguments: input.arguments, ...(input.validation_request === undefined ? {} : { validationRequest: input.validation_request as unknown as Record<string, unknown> }) };
}

test("a corroborating refuter lands on the correction-required closure", async (t) => {
	const harness = driveToFrozen(t, "inferential");
	const input = collectInputFor(harness, "review.capture-refuter");
	const cli = cliWith(() => Buffer.from(JSON.stringify({ resolutions: [{ finding_id: "READ-001", outcome: "corroborated", proof: "the finding reproduces" }] })));
	const outcome = await cli.captureProviderRole!({ captureOperation: "review.capture-refuter", argumentTokens: input.arguments.map(({ token }) => token), cwd: harness.repo });
	if (!("operation" in outcome)) throw new Error("expected a closure outcome");
	assert.equal(outcome.operation, "review.capture-refuter");
	assert.equal(outcome.state, "correction_required");
	assert.equal(outcome.lineageId, harness.start.lineage_id);
});

test("a refuting refuter closes the review approved", async (t) => {
	const harness = driveToFrozen(t, "inferential");
	const input = collectInputFor(harness, "review.capture-refuter");
	const cli = cliWith(() => Buffer.from(JSON.stringify({ resolutions: [{ finding_id: "READ-001", outcome: "refuted", proof: "the claim does not hold on the frozen candidate" }] })));
	const outcome = await cli.captureProviderRole!({ captureOperation: "review.capture-refuter", argumentTokens: input.arguments.map(({ token }) => token), cwd: harness.repo });
	if (!("operation" in outcome)) throw new Error("expected a closure outcome");
	assert.equal(outcome.operation, "review.capture-refuter");
	assert.equal(outcome.state, "approved");
});

test("the validation vector derives the fix from the worktree and closes approved", async (t) => {
	const harness = driveToFrozen(t, "deterministic");
	const planStatus = reviewStatusV1(harness.context, { cwd: harness.repo, lineageId: harness.start.lineage_id });
	const planInput = planStatus.kind === "status" ? planStatus.next_transition?.collect?.inputs.find((row) => row.capture_operation === "review.capture-correction-plan") : undefined;
	if (planInput?.submission === undefined) throw new Error("no correction-plan input");
	const cli = createJeroAuthorityReviewCli();
	// The bounded edit lands BEFORE the plan answer: the capture derives the
	// actual correction lines from the live worktree in the same operation.
	writeFileSync(join(harness.repo, "src", "app.ts"), `${readFileSync(join(harness.repo, "src", "app.ts"), "utf8").replace("export const placeholder = 0;", "export const placeholder = 42;")}`);
	await cli.captureCorrectionPlan!({ argumentTokens: planInput.submission.argument_tokens, correctionLines: 2, cwd: harness.repo });
	const input = collectInputFor(harness, "review.capture-validation");
	const requestHash = String((input.validationRequest ?? {}).request_hash ?? "");
	const roleCli = cliWith(() => Buffer.from(JSON.stringify({
		request_hash: requestHash,
		correction_ids: ["READ-001"],
		original_criteria: { passed: true, evidence: ["original criteria verified"] },
		correction_regression: { passed: true, evidence: ["READ-001 resolved by the correction"] },
		fix_caused_findings: [],
		follow_ups: [],
	})));
	const outcome = await roleCli.captureProviderRole!({ captureOperation: "review.capture-validation", argumentTokens: input.arguments.map(({ token }) => token), cwd: harness.repo });
	if (!("operation" in outcome)) throw new Error("expected a closure outcome");
	assert.equal(outcome.operation, "review/capture-validation");
	assert.equal(outcome.state, "approved");
	// Q-B2 (open): the corrected workspace drifted from the frozen pre-fix
	// snapshot identity, and approved is not a correction-phase state, so the
	// live STATUS cannot see this approved lineage anymore - the burn binding
	// for corrected lineages needs an explicit matching decision.
	const after = reviewStatusV1(harness.context, { cwd: harness.repo, lineageId: harness.start.lineage_id });
	if (after.kind !== "status") throw new Error("status failed");
	assert.equal(after.applicability, "unrelated");
	void readFileSync;
});
