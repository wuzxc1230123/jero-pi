import assert from "node:assert/strict";
import test from "node:test";
import { reviewStartV1 } from "../../lib/authority/start.ts";
import { reviewFinalizeV1 } from "../../lib/authority/finalize.ts";
import { renderJeroCaptureBindingV1, nextJeroCaptureSlotsV1, decodeJeroReviewerResultEnvelopeV1, decodeJeroRefuterResolutionsV1 } from "../../lib/authority/capture.ts";
import { jeroSubmissionArgumentTokensV1, buildJeroReviewerResultCollectInputsV1 } from "../../lib/authority/collect-inputs.ts";
import { mintJeroRepositoryContextV1 } from "../../lib/authority/repository-context.ts";
import { JeroLineageStoreV1 } from "../../lib/authority/lineage-store.ts";
import { admitFixtureReviewerResults, reviewHarness, applyFixtureFix } from "./fixtures.ts";
import { expectedJeroTargetedValidationRequestHashV1 } from "../../lib/authority/validate.ts";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// Spec §A/§I.1/§J.2: renderBinding per slot — purity, eligibility guards,
// prompt content, submission descriptor math, and the strict output-contract
// decoders.

function startedHarness(t: { after: (callback: () => void) => void }) {
	const harness = reviewHarness(t, "medium", 4);
	const start = reviewStartV1(harness.context, { cwd: harness.repo }, { consent: "granted" });
	if (start.kind !== "created") throw new Error(JSON.stringify(start));
	return { harness, start };
}

test("renderBinding for a reviewer slot is store-pure and renders binding, lens contract, output contract, and candidate view", (t) => {
	const { harness, start } = startedHarness(t);
	const before = JeroLineageStoreV1.forStore(harness.context.store.store_root).load(start.lineage_id);
	if (before.kind !== "ok") throw new Error("load failed");
	const rendered = renderJeroCaptureBindingV1({ kind: "reviewer", context: harness.context, lineageId: start.lineage_id, lens: "review-readability", selectedOrder: 0 });
	assert.equal(rendered.kind, "rendered");
	if (rendered.kind !== "rendered") return;
	assert.equal(rendered.slot, "reviewer");
	assert.ok(rendered.promptBytes instanceof Buffer);
	assert.ok(rendered.promptBytes!.length > 0);
	const prompt = rendered.promptBytes!.toString("utf8");
	// 1. Binding header with the exact binding fields (§A.1).
	assert.match(prompt, /^JERO_REVIEW_BINDING \{.*\}\n/);
	assert.match(prompt, /"lineage":"review-[0-9a-f]{16}"/);
	assert.match(prompt, /"lens":"review-readability"/);
	assert.match(prompt, /"order":"0"/);
	assert.match(prompt, /"subject-hash":"sha256:[0-9a-f]{64}"/);
	assert.match(prompt, /"repository-context":"rctx1_[0-9a-f]{64}"/);
	// 2. The lens's compiled instruction set (transcribed from assets/agents/review-readability.md).
	assert.match(prompt, /R2 Readability, a read-only reviewer/);
	assert.match(prompt, /Flag magic numbers that should be named constants/);
	// 3. The shared ledger + output contract.
	assert.match(prompt, /Run this selected lens exactly once against the supplied `initial_review_tree`\./);
	assert.match(prompt, /"review_result": \{/);
	assert.match(prompt, /"lens": "review-readability",/);
	// 4. Read-only candidate view refs into the isolated snapshot object store.
	assert.match(prompt, /isolated object store: /);
	// Store-pure: nothing was written.
	const after = JeroLineageStoreV1.forStore(harness.context.store.store_root).load(start.lineage_id);
	assert.equal(after.kind, "ok");
	assert.equal(after.record.revision, before.record.revision);
	// Continuation routes capture admission through freeze-ledger/finalize.
	assert.deepEqual(rendered.continuation, { admitOperation: "freeze-ledger", inputFor: "finalize" });
	assert.equal(rendered.expectedResultContract.shape, "compact-v2-reviewer-envelope");
});

test("each lens renders its own instruction set", (t) => {
	const harness = reviewHarness(t, "high", 8);
	const start = reviewStartV1(harness.context, { cwd: harness.repo }, { consent: "granted" });
	if (start.kind !== "created") throw new Error(JSON.stringify(start));
	const markers: readonly [import("../../lib/authority/protocol.ts").JeroLensName, RegExp][] = [
		["review-risk", /R1 Risk, a read-only reviewer/],
		["review-resilience", /R4 Resilience, a read-only reviewer/],
		["review-readability", /R2 Readability, a read-only reviewer/],
		["review-reliability", /R3 Reliability, a read-only reviewer/],
	];
	for (const [lens, marker] of markers) {
		const rendered = renderJeroCaptureBindingV1({ kind: "reviewer", context: harness.context, lineageId: start.lineage_id, lens, selectedOrder: markers.findIndex(([candidate]) => candidate === lens) });
		assert.equal(rendered.kind, "rendered", lens);
		if (rendered.kind === "rendered") assert.match(rendered.promptBytes!.toString("utf8"), marker);
	}
});

test("reviewer eligibility guards: wrong state, wrong lens, spent lens, and JD cross-mode are typed refusals", (t) => {
	const { harness, start } = startedHarness(t);
	// Wrong lens for the selected set.
	const wrongLens = renderJeroCaptureBindingV1({ kind: "reviewer", context: harness.context, lineageId: start.lineage_id, lens: "review-risk", selectedOrder: 0 });
	assert.equal(wrongLens.kind, "refused");
	if (wrongLens.kind === "refused") assert.equal(wrongLens.code, "invalid-state");
	// After the lens admitted a result the slot is spent (lenses run exactly once).
	const spentResult = { lens_results: [{ lens: "review-readability" as const, findings: [], evidence: ["clean"] }] };
	admitFixtureReviewerResults(harness, start.lineage_id, spentResult);
	const frozen = reviewFinalizeV1(harness.context, {
		cwd: harness.repo, lineageId: start.lineage_id, reviewer_run_acknowledged: true,
		review_result: spentResult,
	});
	assert.equal(frozen.kind, "frozen");
	const spent = renderJeroCaptureBindingV1({ kind: "reviewer", context: harness.context, lineageId: start.lineage_id, lens: "review-readability", selectedOrder: 0 });
	assert.equal(spent.kind, "refused");
	if (spent.kind === "refused") assert.equal(spent.code, "invalid-state");
	// Unknown lineage and malformed id.
	assert.equal(renderJeroCaptureBindingV1({ kind: "reviewer", context: harness.context, lineageId: "review-1111111111111111", lens: "review-risk", selectedOrder: 0 }).kind, "refused");
	const malformed = renderJeroCaptureBindingV1({ kind: "reviewer", context: harness.context, lineageId: "nope", lens: "review-risk", selectedOrder: 0 });
	assert.equal(malformed.kind, "refused");
	if (malformed.kind === "refused") assert.equal(malformed.code, "invalid-request");
});

test("submission descriptor math: binding tokens − host-only + value token at substitution_location (§B)", (t) => {
	const { harness, start } = startedHarness(t);
	const record = JeroLineageStoreV1.forStore(harness.context.store.store_root).load(start.lineage_id);
	if (record.kind !== "ok") throw new Error("load failed");
	const repositoryContext = mintJeroRepositoryContextV1(harness.context, record.record, "status");
	const [input] = buildJeroReviewerResultCollectInputsV1(harness.context.store.store_root, record.record, repositoryContext);
	assert.ok(input !== undefined);
	// 9 arguments: 7 binding + agent + materialize (fixture: status-v5-capture-result-submission).
	assert.equal(input.arguments.length, 9);
	assert.deepEqual(input.arguments.map(({ name }) => name), ["lineage", "expected-revision", "target", "repository-context", "lens", "order", "subject-hash", "agent", "materialize"]);
	assert.deepEqual(input.arguments.map(({ token }) => token).slice(7), ["--agent=pi", "--materialize=true"]);
	const submission = input.submission!;
	assert.equal(submission.operation_token, "capture-result");
	// argument_tokens = 9 − 2 host tokens + 1 value token = 8; substitution at index 7.
	assert.equal(submission.argument_tokens.length, 8);
	assert.equal(submission.value.substitution_location, 7);
	assert.equal(submission.argument_tokens[7], "--input={{value}}");
	assert.deepEqual(submission.argument_tokens.slice(0, 7), input.arguments.slice(0, 7).map(({ token }) => token));
	assert.equal(submission.value.slot, "reviewer_result");
	assert.equal(submission.value.domain, "artifact_path_or_stdin");
	// The generic helper recomputes exactly this shape.
	const recomputed = jeroSubmissionArgumentTokensV1(input.arguments, "--input={{value}}");
	assert.deepEqual(recomputed.argument_tokens, submission.argument_tokens);
	assert.equal(recomputed.substitution_location, submission.value.substitution_location);
	// The repository-context handle embedded in the arguments is the minted one.
	assert.equal(input.arguments[3]!.value, repositoryContext.handle);
	assert.equal(input.artifact_subject!.lens, "review-readability");
	assert.equal(input.artifact_subject!.authority_revision, record.record.revision);
});

test("correction-plan slot renders the request document + numeric submission; refuter and validator vectors carry no submission", (t) => {
	const { harness, start } = startedHarness(t);
	const planResult = { lens_results: [{ lens: "review-readability" as const, findings: [{ id: "sev-1", severity: "BLOCKER" as const, claim: "bad" }], evidence: ["proof"] }] };
	admitFixtureReviewerResults(harness, start.lineage_id, planResult);
	const frozen = reviewFinalizeV1(harness.context, {
		cwd: harness.repo, lineageId: start.lineage_id, reviewer_run_acknowledged: true,
		review_result: planResult,
	});
	assert.equal(frozen.kind, "frozen");
	const resolved = reviewFinalizeV1(harness.context, {
		cwd: harness.repo, lineageId: start.lineage_id,
		classifications: [{ finding_id: "sev-1", class: "deterministic", proof: "deterministic proof", causal_disposition: "introduced" }],
	});
	assert.equal(resolved.kind, "evidence_resolved");
	// --- correction-plan slot (fix_required) ---
	const plan = renderJeroCaptureBindingV1({ kind: "correction-plan-request", context: harness.context, lineageId: start.lineage_id });
	assert.equal(plan.kind, "rendered");
	if (plan.kind !== "rendered") return;
	assert.equal(plan.slot, "correction-plan-request");
	assert.equal(plan.promptBytes, undefined, "no model spawn belongs to this slot (§A.2)");
	assert.equal(plan.continuation.admitOperation, "authorize-fix");
	const request = plan.requestDocuments.correctionPlan!;
	assert.equal(request.schema, "jero.authority.correction-plan-request/v1");
	assert.deepEqual(request.fix_finding_ids, ["sev-1"]);
	assert.equal(request.findings.length, 1);
	assert.equal(request.findings[0]!.evidence_class, "deterministic");
	assert.equal(request.findings[0]!.causal_disposition, "introduced");
	const planSubmission = plan.submission!;
	assert.equal(planSubmission.value.slot, "correction_lines");
	assert.equal(planSubmission.value.minimum, 1);
	assert.ok(planSubmission.value.maximum! >= 1 && planSubmission.value.maximum! <= 200);
	assert.equal(planSubmission.argument_tokens[planSubmission.value.substitution_location], "--correction-lines={{value}}");
	// --- wrong state: refuter/validator from fix_required refuse typed ---
	const wrongRefuter = renderJeroCaptureBindingV1({ kind: "refuter-vector", context: harness.context, lineageId: start.lineage_id });
	assert.equal(wrongRefuter.kind, "refused");
	if (wrongRefuter.kind === "refused") assert.equal(wrongRefuter.code, "invalid-state");
	const wrongValidator = renderJeroCaptureBindingV1({ kind: "validator-vector", context: harness.context, lineageId: start.lineage_id });
	assert.equal(wrongValidator.kind, "refused");
	if (wrongValidator.kind === "refused") assert.equal(wrongValidator.code, "invalid-state");
});

test("refuter vector renders per-finding refute/confirm instructions with a self-contained shape", (t) => {
	const harness = reviewHarness(t, "medium", 4);
	const start = reviewStartV1(harness.context, { cwd: harness.repo }, { consent: "granted" });
	if (start.kind !== "created") throw new Error("start failed");
	const refuterResult = { lens_results: [{ lens: "review-readability" as const, findings: [{ id: "inf-1", severity: "CRITICAL" as const, claim: "inferential claim" }], evidence: ["proof"] }] };
	admitFixtureReviewerResults(harness, start.lineage_id, refuterResult);
	const frozen = reviewFinalizeV1(harness.context, {
		cwd: harness.repo, lineageId: start.lineage_id, reviewer_run_acknowledged: true,
		review_result: refuterResult,
	});
	assert.equal(frozen.kind, "frozen");
	// Inferential severe candidate-caused: first finalize stages the refuter request.
	const staged = reviewFinalizeV1(harness.context, {
		cwd: harness.repo, lineageId: start.lineage_id,
		classifications: [{ finding_id: "inf-1", class: "inferential", proof: "inferential proof", causal_disposition: "introduced" }],
	});
	assert.equal(staged.kind, "refuter_required");
	const rendered = renderJeroCaptureBindingV1({ kind: "refuter-vector", context: harness.context, lineageId: start.lineage_id });
	assert.equal(rendered.kind, "rendered");
	if (rendered.kind !== "rendered") return;
	assert.equal(rendered.slot, "refuter-vector");
	assert.equal(rendered.submission, undefined, "a submission on this input is a contract violation (§A.3)");
	const prompt = rendered.promptBytes!.toString("utf8");
	assert.match(prompt, /refute or confirm each pending inferential-severe finding independently/i);
	assert.match(prompt, /inf-1/);
	assert.match(prompt, /"resolutions": \[/);
	assert.deepEqual(rendered.continuation, { admitOperation: "resolve-evidence", inputFor: "finalize" });
	// The staged refuter slot is exactly what nextJeroCaptureSlotsV1 offers.
	const slots = nextJeroCaptureSlotsV1(harness.context, start.lineage_id);
	assert.equal(slots.kind, "ok");
	if (slots.kind === "ok") {
		assert.equal(slots.slots.length, 1);
		assert.equal(slots.slots[0]!.kind, "refuter-vector");
	}
});

test("validator slot renders the full targeted-validation request bound to the frozen correction scope", (t) => {
	const harness = reviewHarness(t, "medium", 4);
	const start = reviewStartV1(harness.context, { cwd: harness.repo }, { consent: "granted" });
	if (start.kind !== "created") throw new Error("start failed");
	const validatorResult = { lens_results: [{ lens: "review-readability" as const, findings: [{ id: "sev-1", severity: "BLOCKER" as const, claim: "bad" }], evidence: ["proof"] }] };
	admitFixtureReviewerResults(harness, start.lineage_id, validatorResult);
	const frozen = reviewFinalizeV1(harness.context, {
		cwd: harness.repo, lineageId: start.lineage_id, reviewer_run_acknowledged: true,
		review_result: validatorResult,
	});
	assert.equal(frozen.kind, "frozen");
	const resolved = reviewFinalizeV1(harness.context, {
		cwd: harness.repo, lineageId: start.lineage_id,
		classifications: [{ finding_id: "sev-1", class: "deterministic", proof: "proof", causal_disposition: "introduced" }],
	});
	assert.equal(resolved.kind, "evidence_resolved");
	const authorized = reviewFinalizeV1(harness.context, { cwd: harness.repo, lineageId: start.lineage_id, correction_line_forecast: 2 });
	assert.equal(authorized.kind, "fix_authorized");
	const fix = applyFixtureFix(harness, start.lineage_id, (repo) => {
		const path = join(repo, "src", "app.ts");
		writeFileSync(path, readFileSync(path, "utf8").replace("export const placeholder = 0;", "export const placeholder = 1;"));
	});
	const applied = reviewFinalizeV1(harness.context, { cwd: harness.repo, lineageId: start.lineage_id, fix_application: fix });
	assert.equal(applied.kind, "fix_applied");
	const rendered = renderJeroCaptureBindingV1({ kind: "validator-vector", context: harness.context, lineageId: start.lineage_id });
	assert.equal(rendered.kind, "rendered");
	if (rendered.kind !== "rendered") return;
	assert.equal(rendered.slot, "validator-vector");
	assert.equal(rendered.submission, undefined);
	const request = rendered.requestDocuments.targetedValidation!;
	assert.equal(request.schema, "jero.authority.targeted-validation-request/v1");
	assert.deepEqual(request.fix_finding_ids, ["sev-1"]);
	assert.equal(request.fix_findings.length, 1);
	assert.equal(request.fix_findings[0]!.evidence_class, "deterministic");
	assert.ok(request.correction_paths.length >= 1);
	assert.match(request.request_hash, /^sha256:[0-9a-f]{64}$/);
	// The request hash is the M2 domain hash over the frozen correction scope.
	const store = JeroLineageStoreV1.forStore(harness.context.store.store_root).load(start.lineage_id);
	if (store.kind !== "ok") throw new Error("load failed");
	assert.equal(request.request_hash, `sha256:${expectedJeroTargetedValidationRequestHashV1(store.record.state)}`);
	assert.deepEqual(rendered.continuation, { admitOperation: "validate-fix", inputFor: "validate" });
	const prompt = rendered.promptBytes!.toString("utf8");
	assert.match(prompt, /"request-hash":"/);
	assert.match(prompt, /targeted validator/i);
});

test("strict reviewer envelope decode: unknown keys, missing evidence, bad enums all fail closed", () => {
	const valid = {
		review_result: { lens_results: [{ lens: "review-readability", findings: [], evidence: ["clean sweep"] }] },
	};
	assert.deepEqual(decodeJeroReviewerResultEnvelopeV1(valid).review_result.lens_results[0]!.findings, []);
	// Unknown key at every level.
	assert.throws(() => decodeJeroReviewerResultEnvelopeV1({ ...valid, extra: 1 }), /unknown key "extra"/);
	assert.throws(() => decodeJeroReviewerResultEnvelopeV1({ review_result: { lens_results: [{ lens: "review-readability", findings: [], evidence: ["e"], summary: "x" }] } }), /unknown key "summary"/);
	// Empty findings without evidence (clean results still require it — Mi8).
	assert.throws(() => decodeJeroReviewerResultEnvelopeV1({ review_result: { lens_results: [{ lens: "review-readability", findings: [], evidence: [] }] } }), /empty findings require non-empty evidence/);
	// Missing evidence key.
	assert.throws(() => decodeJeroReviewerResultEnvelopeV1({ review_result: { lens_results: [{ lens: "review-readability", findings: [] }] } }), /missing key "evidence"/);
	// Mi8 (review ruling): findings PRESENT — evidence may be empty (each
	// finding carries its own proof_refs); the dead always-non-empty line is
	// gone.
	const fullRow = { id: "X-1", lens: "review-readability", location: "a.ts:1", severity: "CRITICAL", claim: "c", evidence_class: "deterministic", causal_disposition: "introduced", proof_refs: ["changed-hunk:a.ts:1"] };
	assert.doesNotThrow(() => decodeJeroReviewerResultEnvelopeV1({ review_result: { lens_results: [{ lens: "review-readability", findings: [fullRow], evidence: [] }] } }));
	// Empty-string evidence rows are still malformed.
	assert.throws(() => decodeJeroReviewerResultEnvelopeV1({ review_result: { lens_results: [{ lens: "review-readability", findings: [fullRow], evidence: [""] }] } }), /evidence/);
	// Bad severity / evidence_class / causal_disposition.
	const row = (overrides: Record<string, unknown>) => ({ id: "X-1", lens: "review-readability", location: "a.ts:1", severity: "CRITICAL", claim: "c", evidence_class: "deterministic", causal_disposition: "introduced", proof_refs: ["changed-hunk:a.ts:1"], ...overrides });
	assert.throws(() => decodeJeroReviewerResultEnvelopeV1({ review_result: { lens_results: [{ lens: "review-readability", findings: [row({ severity: "CATASTROPHIC" })], evidence: ["e"] }] } }), /severity/);
	assert.throws(() => decodeJeroReviewerResultEnvelopeV1({ review_result: { lens_results: [{ lens: "review-readability", findings: [row({ evidence_class: "vibes" })], evidence: ["e"] }] } }), /evidence_class/);
	assert.throws(() => decodeJeroReviewerResultEnvelopeV1({ review_result: { lens_results: [{ lens: "review-readability", findings: [row({ causal_disposition: "alien" })], evidence: ["e"] }] } }), /causal_disposition/);
	// Empty proof_refs.
	assert.throws(() => decodeJeroReviewerResultEnvelopeV1({ review_result: { lens_results: [{ lens: "review-readability", findings: [row({ proof_refs: [] })], evidence: ["e"] }] } }), /proof_refs/);
	// More than one lens result.
	assert.throws(() => decodeJeroReviewerResultEnvelopeV1({ review_result: { lens_results: [valid.review_result.lens_results[0], valid.review_result.lens_results[0]] } }), /exactly one/);
});

test("strict refuter decode: outcome domain and duplicate detection", () => {
	const valid = { resolutions: [{ finding_id: "f-1", outcome: "refuted", proof: "disproof" }] };
	assert.equal(decodeJeroRefuterResolutionsV1(valid).resolutions[0]!.outcome, "refuted");
	assert.throws(() => decodeJeroRefuterResolutionsV1({ resolutions: [{ finding_id: "f-1", outcome: "maybe", proof: "p" }] }), /outcome/);
	assert.throws(() => decodeJeroRefuterResolutionsV1({ resolutions: [{ finding_id: "f-1", outcome: "refuted" }] }), /missing key "proof"/);
	assert.throws(() => decodeJeroRefuterResolutionsV1({ resolutions: [{ finding_id: "f-1", outcome: "refuted", proof: "p" }, { finding_id: "f-1", outcome: "refuted", proof: "p" }] }), /duplicated finding f-1/);
	assert.throws(() => decodeJeroRefuterResolutionsV1({ resolutions: [] }), /non-empty/);
});
