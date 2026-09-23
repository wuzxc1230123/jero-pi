import assert from "node:assert/strict";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { reviewStartV1 } from "../../lib/authority/start.ts";
import { JeroLineageStoreV1 } from "../../lib/authority/lineage-store.ts";
import { JeroObjectCasV1 } from "../../lib/authority/object-cas.ts";
import { canonicalBytesV1, sha256Hex } from "../../lib/review-canonical.ts";
import {
	admitJeroReviewerResultV1,
	capturedJeroArtifactsCompleteV1,
	decodeJeroResultArtifactV1,
	jeroResultArtifactReferenceV1,
	jeroReviewerResultsDirectoryV1,
	listJeroResultArtifactsV1,
	JERO_RESULT_ARTIFACT_SCHEMA,
} from "../../lib/authority/result-artifacts.ts";
import { jeroArtifactSubjectForRecordV1 } from "../../lib/authority/collect-inputs.ts";
import { reviewHarness } from "./fixtures.ts";

// Spec §D/§J.2: result-artifact admission — sha256 recompute, subject/order
// binding, path XOR reference, NN-lens persistence + CAS install, and the
// captured-artifacts-complete predicate.

function envelope(lens: string, findings: unknown[] = []): Buffer {
	return Buffer.from(JSON.stringify({ review_result: { lens_results: [{ lens, findings, evidence: ["scope-reviewed evidence"] }] } }));
}

function started(t: { after: (callback: () => void) => void }) {
	const harness = reviewHarness(t, "medium", 4);
	const start = reviewStartV1(harness.context, { cwd: harness.repo }, { consent: "granted" });
	if (start.kind !== "created") throw new Error(JSON.stringify(start));
	const loaded = JeroLineageStoreV1.forStore(harness.context.store.store_root).load(start.lineage_id);
	if (loaded.kind !== "ok") throw new Error("load failed");
	return { harness, start, record: loaded.record };
}

test("admission persists raw bytes at <NN>-<lens>.json, installs the envelope in the CAS, and lists via the manifest", (t) => {
	const { harness, start, record } = started(t);
	const raw = envelope("review-readability");
	const admission = admitJeroReviewerResultV1(harness.context, {
		lineageId: start.lineage_id,
		lens: "review-readability",
		selectedOrder: 0,
		subjectHash: jeroArtifactSubjectForRecordV1(harness.context.store.store_root, record, "review-readability", 0).subject_hash,
		rawResultBytes: raw,
		locator: "path",
	});
	assert.equal(admission.kind, "admitted");
	if (admission.kind !== "admitted") return;
	assert.equal(admission.replayed, false);
	const artifact = admission.artifact;
	assert.equal(artifact.admission_decision, "completed");
	assert.equal(artifact.lens, "review-readability");
	assert.equal(artifact.selected_order, 0);
	assert.equal(artifact.sha256, `sha256:${sha256Hex(raw)}`);
	// Path form: the store reviewer-results path with the NN=00 filename.
	assert.equal(artifact.path, join(jeroReviewerResultsDirectoryV1(harness.context.store.store_root, start.lineage_id), "00-review-readability.json"));
	assert.equal(artifact.reference, undefined);
	// Raw bytes verbatim on disk.
	assert.deepEqual(readFileSync(artifact.path!), raw);
	// The typed envelope is in the CAS under its content hash.
	const cas = JeroObjectCasV1.forStore(harness.context.store.store_root);
	const stored = cas.get(sha256Hex(canonicalBytesV1(artifact)), (value) => value);
	assert.equal((stored as { schema: string }).schema, JERO_RESULT_ARTIFACT_SCHEMA);
	// Discovery lists it; completeness holds for the single-lens selection.
	assert.deepEqual(listJeroResultArtifactsV1(harness.context, start.lineage_id).map(({ lens }) => lens), ["review-readability"]);
	const completeness = capturedJeroArtifactsCompleteV1(harness.context, record);
	assert.equal(completeness.complete, true);
	// Exact re-admission replays; the manifest stays one row.
	const replay = admitJeroReviewerResultV1(harness.context, {
		lineageId: start.lineage_id, lens: "review-readability", selectedOrder: 0,
		subjectHash: artifact.subject_hash, rawResultBytes: raw, locator: "path",
	});
	assert.equal(replay.kind, "admitted");
	if (replay.kind === "admitted") assert.equal(replay.replayed, true);
	assert.equal(listJeroResultArtifactsV1(harness.context, start.lineage_id).length, 1);
});

test("reference locator: same bytes mint the rart1_ reference and the identical sha256", (t) => {
	const pathSide = started(t);
	const referenceSide = started(t);
	const raw = envelope("review-readability");
	const pathSubject = jeroArtifactSubjectForRecordV1(pathSide.harness.context.store.store_root, pathSide.record, "review-readability", 0).subject_hash;
	const referenceSubject = jeroArtifactSubjectForRecordV1(referenceSide.harness.context.store.store_root, referenceSide.record, "review-readability", 0).subject_hash;
	const pathAdmission = admitJeroReviewerResultV1(pathSide.harness.context, { lineageId: pathSide.start.lineage_id, lens: "review-readability", selectedOrder: 0, subjectHash: pathSubject, rawResultBytes: raw, locator: "path" });
	const referenceAdmission = admitJeroReviewerResultV1(referenceSide.harness.context, { lineageId: referenceSide.start.lineage_id, lens: "review-readability", selectedOrder: 0, subjectHash: referenceSubject, rawResultBytes: raw, locator: "reference" });
	// Fixture proof (result-artifact-v2 vs -path): the SAME sha256 for both
	// locator forms of the same admission; only the locator differs.
	assert.equal(referenceAdmission.kind, "admitted");
	if (referenceAdmission.kind !== "admitted" || pathAdmission.kind !== "admitted") return;
	assert.equal(referenceAdmission.artifact.sha256, pathAdmission.artifact.sha256);
	assert.equal(referenceAdmission.artifact.path, undefined);
	assert.match(referenceAdmission.artifact.reference!, /^rart1_[0-9a-f]{64}$/);
	assert.equal(referenceAdmission.artifact.reference, jeroResultArtifactReferenceV1(referenceSubject, referenceAdmission.artifact.sha256));
});

test("admission refusals: sha mismatch, subject mismatch, slot consumed, invalid envelope, wrong state", (t) => {
	const { harness, start, record } = started(t);
	const subject = jeroArtifactSubjectForRecordV1(harness.context.store.store_root, record, "review-readability", 0);
	const base = { lineageId: start.lineage_id, lens: "review-readability" as const, selectedOrder: 0, rawResultBytes: envelope("review-readability") };
	// Declared sha mismatch.
	const mismatch = admitJeroReviewerResultV1(harness.context, { ...base, subjectHash: subject.subject_hash, declaredSha256: `sha256:${"0".repeat(64)}`, locator: "path" });
	assert.equal(mismatch.kind, "refused");
	if (mismatch.kind === "refused") assert.equal(mismatch.code, "sha256-mismatch");
	// Subject mismatch: a foreign subject hash.
	const foreign = admitJeroReviewerResultV1(harness.context, { ...base, subjectHash: `sha256:${"e".repeat(64)}`, locator: "path" });
	assert.equal(foreign.kind, "refused");
	if (foreign.kind === "refused") assert.equal(foreign.code, "subject-mismatch");
	// Order mismatch: lens not at the offered order.
	const wrongOrder = admitJeroReviewerResultV1(harness.context, { ...base, selectedOrder: 1, subjectHash: subject.subject_hash, locator: "path" });
	assert.equal(wrongOrder.kind, "refused");
	if (wrongOrder.kind === "refused") assert.equal(wrongOrder.code, "subject-mismatch");
	// Invalid envelope bytes.
	const garbage = admitJeroReviewerResultV1(harness.context, { ...base, subjectHash: subject.subject_hash, rawResultBytes: Buffer.from("not json"), locator: "path" });
	assert.equal(garbage.kind, "refused");
	if (garbage.kind === "refused") assert.equal(garbage.code, "invalid-envelope");
	// Envelope for a different lens than the offered slot.
	const wrongLensEnvelope = admitJeroReviewerResultV1(harness.context, { ...base, subjectHash: subject.subject_hash, rawResultBytes: envelope("review-risk"), locator: "path" });
	assert.equal(wrongLensEnvelope.kind, "refused");
	if (wrongLensEnvelope.kind === "refused") assert.equal(wrongLensEnvelope.code, "subject-mismatch");
	// Happy admission, then a divergent second admission for the same lens.
	const admitted = admitJeroReviewerResultV1(harness.context, { ...base, subjectHash: subject.subject_hash, locator: "path" });
	assert.equal(admitted.kind, "admitted");
	const divergent = admitJeroReviewerResultV1(harness.context, { ...base, subjectHash: subject.subject_hash, rawResultBytes: envelope("review-readability", [{ id: "X-1", lens: "review-readability", location: "a:1", severity: "WARNING", claim: "c", evidence_class: "inferential", causal_disposition: "pre-existing", proof_refs: ["changed-hunk:a:1"] }]), locator: "path" });
	assert.equal(divergent.kind, "refused");
	if (divergent.kind === "refused") assert.equal(divergent.code, "slot-consumed");
	// Missing lineage.
	const missing = admitJeroReviewerResultV1(harness.context, { ...base, lineageId: "review-1111111111111111", subjectHash: subject.subject_hash, locator: "path" });
	assert.equal(missing.kind, "refused");
	if (missing.kind === "refused") assert.equal(missing.code, "lineage-missing");
});

test("completeness: a selection with a missing lens artifact is incomplete", (t) => {
	const harness = reviewHarness(t, "high", 8);
	const start = reviewStartV1(harness.context, { cwd: harness.repo }, { consent: "granted" });
	if (start.kind !== "created") throw new Error("start failed");
	const loaded = JeroLineageStoreV1.forStore(harness.context.store.store_root).load(start.lineage_id);
	if (loaded.kind !== "ok") throw new Error("load failed");
	const record = loaded.record;
	assert.ok((record.state.selected_lenses ?? []).length >= 2, "high risk selects multiple lenses");
	const first = (record.state.selected_lenses ?? [])[0]!;
	const subject = jeroArtifactSubjectForRecordV1(harness.context.store.store_root, record, first, 0);
	const admission = admitJeroReviewerResultV1(harness.context, { lineageId: start.lineage_id, lens: first, selectedOrder: 0, subjectHash: subject.subject_hash, rawResultBytes: envelope(first), locator: "path" });
	assert.equal(admission.kind, "admitted");
	const completeness = capturedJeroArtifactsCompleteV1(harness.context, record);
	assert.equal(completeness.complete, false);
	assert.ok(completeness.missing.length >= 1);
	assert.equal(existsSync(join(jeroReviewerResultsDirectoryV1(harness.context.store.store_root, start.lineage_id), "artifacts.json")), true);
});

test("strict artifact decode: both locators, neither locator, bad reference, bad order", () => {
	const base = {
		schema: JERO_RESULT_ARTIFACT_SCHEMA,
		capability: "review.native_result_artifact",
		sha256: `sha256:${"a".repeat(64)}`,
		lineage_id: "review-0123456789abcdef",
		target_identity: `sha256:${"b".repeat(64)}`,
		lens: "review-risk",
		selected_order: 0,
		subject_hash: `sha256:${"c".repeat(64)}`,
		admission_decision: "completed",
	};
	assert.equal(decodeJeroResultArtifactV1({ ...base, path: "/store/x.json" }).path, "/store/x.json");
	assert.equal(decodeJeroResultArtifactV1({ ...base, reference: `rart1_${"d".repeat(64)}` }).reference, `rart1_${"d".repeat(64)}`);
	assert.throws(() => decodeJeroResultArtifactV1({ ...base, path: "x", reference: `rart1_${"d".repeat(64)}` }), /exactly one/);
	assert.throws(() => decodeJeroResultArtifactV1(base), /exactly one/);
	assert.throws(() => decodeJeroResultArtifactV1({ ...base, path: "x", reference: "rart2_zzz" }), /exactly one/);
	assert.throws(() => decodeJeroResultArtifactV1({ ...base, reference: "not-a-reference" }), /rart1_/);
	assert.throws(() => decodeJeroResultArtifactV1({ ...base, reference: `rart1_${"d".repeat(64)}`, selected_order: 4 }), /0\.\.3/);
	assert.throws(() => decodeJeroResultArtifactV1({ ...base, reference: `rart1_${"d".repeat(64)}`, admission_decision: "refused" }), /completed/);
	assert.throws(() => decodeJeroResultArtifactV1({ ...base, reference: `rart1_${"d".repeat(64)}`, extra: 1 }), /unknown key/);
});

test("MA4: completeness verifies the per-lens files — deleted or rewritten results are incomplete", (t) => {
	const { harness, start, record } = started(t);
	const raw = envelope("review-readability");
	const subject = jeroArtifactSubjectForRecordV1(harness.context.store.store_root, record, "review-readability", 0).subject_hash;
	assert.equal(admitJeroReviewerResultV1(harness.context, { lineageId: start.lineage_id, lens: "review-readability", selectedOrder: 0, subjectHash: subject, rawResultBytes: raw, locator: "path" }).kind, "admitted");
	assert.equal(capturedJeroArtifactsCompleteV1(harness.context, record).complete, true);
	const resultFile = join(jeroReviewerResultsDirectoryV1(harness.context.store.store_root, start.lineage_id), "00-review-readability.json");
	// Deleted file: the manifest still lists the artifact, but the disk
	// verification fails closed.
	rmSync(resultFile, { force: true });
	assert.equal(capturedJeroArtifactsCompleteV1(harness.context, record).complete, false);
	// Restored file: complete again.
	writeFileSync(resultFile, raw);
	assert.equal(capturedJeroArtifactsCompleteV1(harness.context, record).complete, true);
	// Rewritten file (present but hashing to something else): incomplete.
	writeFileSync(resultFile, "tampered after admission\n");
	const tampered = capturedJeroArtifactsCompleteV1(harness.context, record);
	assert.equal(tampered.complete, false);
	assert.deepEqual(tampered.missing, [{ lens: "review-readability", selected_order: 0 }]);
});
