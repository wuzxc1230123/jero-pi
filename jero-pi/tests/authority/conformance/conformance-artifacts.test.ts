import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { decodeReviewResultArtifactV2 } from "../../../lib/review-integration-v2.ts";
import { jeroReviewerResultsDirectoryV1 } from "../../../lib/authority/result-artifacts.ts";

// §J.1 assertion 8: result-artifact-v2 + result-artifact-v2-path — the same
// admission under both locators. Internal consistency and the NN=00
// filename mapping; never upstream hash bytes (the shared sha256 is asserted
// to be IDENTICAL between the two fixtures, not to any expected value).

const fixturesRoot = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "fixtures", "devbinary");

function fixture(name: string): Record<string, unknown> {
	return JSON.parse(readFileSync(join(fixturesRoot, `${name}.captured.json`), "utf8")) as Record<string, unknown>;
}

test("conformance 8: both locator forms carry the identical sha256; path XOR reference; admission completed; order 0; NN=00 filename", () => {
	const reference = decodeReviewResultArtifactV2(fixture("result-artifact-v2"));
	const path = decodeReviewResultArtifactV2(fixture("result-artifact-v2-path"));
	// The same admitted bytes: identical sha256, lineage, lens, order, subject.
	assert.equal(reference.sha256, path.sha256);
	assert.equal(reference.lineageId, path.lineageId);
	assert.equal(reference.targetIdentity, path.targetIdentity);
	assert.equal(reference.lens, path.lens);
	assert.equal(reference.selectedOrder, path.selectedOrder);
	assert.equal(reference.subjectHash, path.subjectHash);
	// Exactly one locator each: the reference form and the path form.
	assert.equal(reference.path, undefined);
	assert.match(reference.reference!, /^rart1_[0-9a-f]{64}$/);
	assert.equal(path.reference, undefined);
	assert.ok(path.path!.length > 0);
	// admission_decision is closed to "completed" (decoder hard-rejects others).
	assert.equal(reference.admissionDecision, "completed");
	assert.equal(path.admissionDecision, "completed");
	assert.equal(reference.selectedOrder, 0);
	// NN=00 filename mapping for the path form: the upstream store layout is
	// reviewer-results/<NN>-<lens>.json — jero's admission path is the same
	// mapping from selected_order and lens.
	const normalized = path.path!.split("\\").join("/");
	assert.ok(normalized.endsWith("reviewer-results/00-review-reliability.json"));
	const storePath = path.path!;
	assert.equal(storePath.split(/[/\\]/).at(-1), `00-${reference.lens}.json`);
	// jero isomorphism: our reviewer-results directory derives from the same
	// lineage id, and the filename derives from the zero-padded-2 order.
	const jeroDirectory = jeroReviewerResultsDirectoryV1("unused-store", path.lineageId);
	assert.ok(jeroDirectory.endsWith(join("lineages", path.lineageId, "reviewer-results")));
});
