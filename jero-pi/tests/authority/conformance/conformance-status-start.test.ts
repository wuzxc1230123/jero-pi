import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { decodeReviewNextTransitionV3, decodeReviewStartV3, type ReviewCollectInputV3 } from "../../../lib/review-integration-v2.ts";
import { buildJeroReviewerResultCollectInputsV1, buildJeroFinalizeExecuteTransitionV1, JERO_CAPTURE_INPUT_SCHEMA_CONFORMANCE_MAP, jeroSubmissionArgumentTokensV1 } from "../../../lib/authority/collect-inputs.ts";
import { mintJeroRepositoryContextV1 } from "../../../lib/authority/repository-context.ts";
import { jeroAdvisoryFindingsFromStateV1 } from "../../../lib/authority/closures.ts";
import { JERO_LINEAGE_STATE_SCHEMA } from "../../../lib/authority/canonical.ts";
import { testTransactionState } from "../fixtures.ts";
import type { JeroLineageStateFileV1 } from "../../../lib/authority/lineage-store.ts";
import type { JeroAuthorityContextV1 } from "../../../lib/authority/review.ts";

// §J.1 assertions 7, 9, 10: the status/v5 collect input, the
// repository-context execute block, and the START repository-context +
// artifact-subject discipline. Field-level isomorphism under the documented
// schema-string mapping (discrepancy #2 discipline); internal consistency
// recomputed with jero's own descriptor math; never upstream hash bytes.

const fixturesRoot = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "fixtures", "devbinary");

function fixture(name: string): Record<string, unknown> {
	return JSON.parse(readFileSync(join(fixturesRoot, `${name}.captured.json`), "utf8")) as Record<string, unknown>;
}

function recordFor(lineageId: string, overrides: Record<string, unknown> = {}): JeroLineageStateFileV1 {
	const state = testTransactionState(lineageId);
	Object.assign(state, overrides);
	return { schema: JERO_LINEAGE_STATE_SCHEMA, lineage_id: lineageId, revision: `sha256:${"1".repeat(64)}`, state, request_journal: [] };
}

// 7. status-v5-capture-result-submission
test("conformance 7: the capture-result collect input — 9 exact arguments, singular submission value, artifact subject, repository-context echo", () => {
	// Top level is raw JSON: the vendored upstream decoder's action enum
	// predates action:"finalize" (the documented M2 discrepancy #2 — the
	// schema union is the vocabulary). The next_transition itself is strictly
	// decoded through the v5 surface.
	const raw = fixture("status-v5-capture-result-submission");
	assert.equal(raw.applicability, "current_target");
	assert.equal(raw.action, "finalize");
	const next = decodeReviewNextTransitionV3(raw.next_transition, { v5: true });
	assert.equal(next.kind, "collect");
	assert.equal(next.reasonCode, "reviewer_results_required");
	const input: ReviewCollectInputV3 = next.collect!.inputs[0]!;
	// 9 arguments with exact tokens incl. the host pair.
	assert.equal(input.arguments.length, 9);
	assert.deepEqual(input.arguments.map(({ name }) => name), ["lineage", "expected-revision", "target", "repository-context", "lens", "order", "subject-hash", "agent", "materialize"]);
	for (const argument of input.arguments) assert.equal(argument.token, `--${argument.name}=${argument.value}`);
	assert.deepEqual(input.arguments.slice(7).map(({ name, value }) => [name, value]), [["agent", "pi"], ["materialize", "true"]]);
	// Submission: SINGULAR value row {slot reviewer_result, domain artifact_path_or_stdin, schema, substitution_location 7}.
	const submission = input.submission!;
	assert.equal(submission.operationToken, "capture-result");
	assert.equal(submission.values.length, 1);
	const value = submission.values[0]!;
	assert.equal(value.slot, "reviewer_result");
	assert.equal(value.domain, "artifact_path_or_stdin");
	assert.equal(value.schema, "https://gentle-ai.dev/schema/review/reviewer/v1");
	assert.equal(value.substitutionLocation, 7);
	// INTERNAL CONSISTENCY via jero's own math: argument_tokens = the 9
	// arguments − the 2 host tokens + the value token at index 7.
	const recomputed = jeroSubmissionArgumentTokensV1(input.arguments, "--input={{value}}");
	assert.deepEqual(recomputed.argument_tokens, submission.argumentTokens);
	assert.equal(recomputed.substitution_location, value.substitutionLocation);
	assert.equal(submission.argumentTokens[7], "--input={{value}}");
	// Artifact subject: the full v2 field set; subject-hash argument == subject.subject_hash.
	const subject = input.artifactSubject!;
	const subjectRaw = (fixture("status-v5-capture-result-submission").next_transition as { collect: { inputs: Record<string, unknown>[] } }).collect.inputs[0]!;
	const subjectFields = Object.keys(subjectRaw.artifact_subject as Record<string, unknown>).toSorted();
	assert.deepEqual(subjectFields, ["authority_revision", "base_tree", "candidate_tree", "changed_path_manifest_sha256", "lens", "lineage_id", "schema", "selected_order", "subject_hash", "target_identity"].toSorted());
	assert.equal(input.arguments[6]!.value, subject.subjectHash);
	// Repository-context: the STATUS block handle is the one embedded in the
	// collect argument, verbatim.
	const repositoryContext = raw.repository_context as Record<string, unknown>;
	assert.equal(input.arguments[3]!.value, repositoryContext.handle);
	assert.match(String(repositoryContext.handle), /^rctx1_[0-9a-f]{64}$/);
	const authority = raw.authority as Record<string, unknown>;
	assert.equal(repositoryContext.revision, authority.revision);
	assert.equal(repositoryContext.target_identity, raw.target_identity);
	// Frozen block: tier/lines/budget with the 3→2 halving.
	assert.deepEqual(raw.frozen, { tier: "medium", original_changed_lines: 3, correction_budget: 2 });
	// jero isomorphism: our builder emits the same argument-name sequence,
	// token discipline, and submission shape (schema string maps at the
	// conformance boundary).
	const context = { store: { store_root: "unused" }, locks: { inspect: () => ({ status: "released" }) } } as unknown as JeroAuthorityContextV1;
	const record = recordFor(String(authority.lineage_id), { selected_lenses: ["review-readability"], lens_results: undefined, state: "reviewing" });
	record.state.snapshot.identity = String(raw.target_identity);
	record.state.snapshot.candidate_tree = subject.candidateTree;
	record.state.base_tree = subject.baseTree;
	record.state.changed_path_manifest_sha256 = subject.changedPathManifestSha256;
	const jeroInputs = buildJeroReviewerResultCollectInputsV1("unused", record, mintJeroRepositoryContextV1(context, record, "status"));
	const jeroInput = jeroInputs.find((candidate) => candidate.arguments.some((argument) => argument.name === "lens" && argument.value === "review-readability"))!;
	assert.deepEqual(jeroInput.arguments.map(({ name }) => name), input.arguments.map(({ name }) => name));
	assert.equal(jeroInput.submission!.value.slot, value.slot);
	assert.equal(jeroInput.submission!.value.domain, value.domain);
	assert.equal(JERO_CAPTURE_INPUT_SCHEMA_CONFORMANCE_MAP[jeroInput.schema], input.schema);
	assert.equal(jeroInput.submission!.value.schema && JERO_CAPTURE_INPUT_SCHEMA_CONFORMANCE_MAP[jeroInput.submission!.value.schema], value.schema);
});

// 9. status-v5-repository-context
test("conformance 9: execute review.finalize — preconditions, admitted artifacts, repository-context binding", () => {
	const raw = fixture("status-v5-repository-context");
	assert.equal(raw.action, "finalize");
	// Raw here too: the vendored transition decoder's operation list predates
	// review.finalize (same discrepancy #2 family — the schema union wins).
	const next = raw.next_transition as Record<string, unknown>;
	assert.equal(next.kind, "execute");
	assert.equal(next.reason_code, "captured_results_ready");
	const execute = next.execute as Record<string, unknown>;
	assert.equal(execute.operation, "review.finalize");
	assert.deepEqual((execute.preconditions as { name: string; value: string }[]).map(({ name, value }) => ({ name, value })), [
		{ name: "state", value: "reviewing" },
		{ name: "captured_artifacts", value: "complete" },
	]);
	// The admitted result-artifact list.
	const artifacts = execute.artifacts as Record<string, unknown>[];
	assert.equal(artifacts.length, 1);
	assert.equal(artifacts[0]!.lens, "review-reliability");
	assert.equal(artifacts[0]!.admission_decision, "completed");
	// The execute binding carries the BARE repository-context handle.
	const binding = execute.binding as Record<string, unknown>;
	assert.match(String(binding.repository_context), /^rctx1_[0-9a-f]{64}$/);
	const repositoryContext = fixture("status-v5-repository-context").repository_context as Record<string, unknown>;
	assert.equal(binding.repository_context, repositoryContext.handle);
	const authority = raw.authority as Record<string, unknown>;
	// jero isomorphism: our execute builder emits the same operation,
	// preconditions, and bare-handle binding.
	const state = testTransactionState(String(authority.lineage_id));
	state.state = "reviewing";
	state.selected_lenses = ["review-reliability"];
	const record: JeroLineageStateFileV1 = { schema: JERO_LINEAGE_STATE_SCHEMA, lineage_id: String(authority.lineage_id), revision: String(authority.revision), state, request_journal: [] };
	record.state.snapshot.identity = String(raw.target_identity);
	const context = { store: { store_root: "unused" }, locks: { inspect: () => ({ status: "released" }) } } as unknown as JeroAuthorityContextV1;
	const minted = mintJeroRepositoryContextV1(context, record, "status");
	const jeroExecute = buildJeroFinalizeExecuteTransitionV1(record, minted, []);
	assert.equal(jeroExecute.operation, execute.operation);
	assert.deepEqual(jeroExecute.preconditions, (execute.preconditions as { name: string; value: string }[]).map(({ name, value }) => ({ name, value })));
	assert.equal(jeroExecute.binding.repository_context, minted.handle);
});

// 10. start-v3-consent-granted
test("conformance 10: START repository-context event pairing and four subjects sharing revision/base/candidate/manifest", () => {
	const start = decodeReviewStartV3(fixture("start-v3-consent-granted"));
	assert.equal(start.action, "created");
	const raw = fixture("start-v3-consent-granted");
	const repositoryContext = raw.repository_context as Record<string, unknown>;
	// event_id ⇔ outcome are paired and applied.
	assert.ok(repositoryContext.event_id !== undefined && repositoryContext.outcome !== undefined);
	assert.equal(repositoryContext.outcome, "applied");
	assert.match(String(repositoryContext.event_id), /^sha256:[0-9a-f]{64}$/);
	// 4 subjects sharing authority_revision/base/candidate/manifest, differing in lens/order.
	const subjects = raw.artifact_subjects as Record<string, unknown>[];
	assert.equal(subjects.length, 4);
	for (const field of ["authority_revision", "base_tree", "candidate_tree", "changed_path_manifest_sha256", "lineage_id", "target_identity"]) {
		assert.equal(new Set(subjects.map((subject) => subject[field])).size, 1, field);
	}
	assert.deepEqual(subjects.map(({ selected_order }) => selected_order), [0, 1, 2, 3]);
	assert.deepEqual(subjects.map(({ lens }) => lens), ["review-risk", "review-resilience", "review-readability", "review-reliability"]);
	// jero isomorphism: our repository-context minting always pairs event_id
	// with outcome and derives applied for a completed start entry.
	const state = testTransactionState("review-377c60e10b852cfc");
	const record: JeroLineageStateFileV1 = {
		schema: JERO_LINEAGE_STATE_SCHEMA,
		lineage_id: "review-377c60e10b852cfc",
		revision: repositoryContext.revision as string,
		state,
		request_journal: [{ operation: "start", idempotency_key: "conformance", request_hash: "0".repeat(64), status: "completed" }],
	};
	record.state.snapshot.identity = (repositoryContext.target_identity as string);
	const context = { store: { store_root: "unused" }, locks: { inspect: () => ({ status: "released" }) } } as unknown as JeroAuthorityContextV1;
	const minted = mintJeroRepositoryContextV1(context, record, "start");
	assert.equal(minted.outcome, "applied");
	assert.notEqual(minted.event_id, undefined);
	// ADVISORY (informational): the shared-fields discipline is what jero's
	// STATUS-side subject derivation guarantees per lens/order.
	void jeroAdvisoryFindingsFromStateV1;
});
