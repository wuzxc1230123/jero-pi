// review-integration-v2 测试第 1 段（留守原文件名）（共 2 段；夹具在 review-integration-v2-shared.ts）。
// 机械平移自原 review-integration-v2.test.ts，语义零改动。

import { default as assert } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { default as test } from "node:test";
import {
	decodeAuthorityRepairAssessmentV1, decodeReviewArtifactSubjectV2, decodeReviewCapabilitiesV2,
	decodeReviewConsentV2, decodeReviewFailureV2, decodeReviewNextTransitionV3,
	decodeReviewProjectionV1, decodeReviewRepairV2, decodeReviewStartV3, decodeReviewStatusV3,
	REVIEW_INTEGRATION_CONTRACT, REVIEW_START_STATE
} from "../lib/authority/wire-contract.ts";
import {
	assertAdditionalProperty, assertNestedRequired, assertRequired, clone, type Decoder, devFixture,
	devFixtureRoot, digest, executableDigest, fixture, fixtureRoot, type JsonObject,
	repairAssessment, unachievableSlot,
} from "./review-integration-v2-shared.ts";

test("current review integration fixtures decode", () => {
	assert.equal(decodeReviewCapabilitiesV2(fixture("capabilities.fixture.json"), executableDigest).contract, REVIEW_INTEGRATION_CONTRACT);
	assert.equal(decodeReviewStartV3(fixture("start.fixture.json")).riskLevel, "high");
	assert.equal(decodeReviewConsentV2(fixture("consent.fixture.json")).action, "consent_required");
});

test("capabilities enforce every required top-level and nested property", () => {
	const source = fixture<JsonObject>("capabilities.fixture.json");
	const decode: Decoder = (value) => decodeReviewCapabilitiesV2(value, executableDigest);
	assertRequired(decode, source, ["schema", "contract", "protocol", "package", "build", "executable", "operations", "gates", "projections", "schemas", "features", "compatibility"]);
	assertNestedRequired(decode, source, ["protocol"], ["major", "minor"]);
	assertNestedRequired(decode, source, ["package"], ["name", "version", "release_channel"]);
	assertNestedRequired(decode, source, ["build"], ["id", "go_version", "module_version", "vcs", "vcs_revision", "vcs_time", "vcs_modified"]);
	assertNestedRequired(decode, source, ["executable"], ["sha256", "evidence", "verification"]);
	assertNestedRequired(decode, source, ["features"], ["mandatory", "optional"]);
	assertNestedRequired(decode, source, ["compatibility"], ["minimum_protocol_major", "maximum_protocol_major", "additive_minor_policy", "unknown_mandatory", "unknown_optional", "modes", "legacy_window"]);
});

test("capabilities reject additional properties at every exact object boundary", () => {
	const source = fixture<JsonObject>("capabilities.fixture.json");
	const decode: Decoder = (value) => decodeReviewCapabilitiesV2(value, executableDigest);
	for (const path of [[], ["protocol"], ["package"], ["build"], ["executable"], ["features"], ["compatibility"], ["compatibility", "legacy_window"]] as const) {
		assertAdditionalProperty(decode, source, path);
	}
});

test("capabilities reject an incompatible protocol identity", () => {
	const source = fixture<JsonObject>("capabilities.fixture.json");
	const decode: Decoder = (value) => decodeReviewCapabilitiesV2(value, executableDigest);
	const wrongMajor = clone(source);
	(wrongMajor.protocol as JsonObject).major = 1;
	assert.throws(() => decode(wrongMajor), /incompatible/);
	const wrongMinor = clone(source);
	(wrongMinor.protocol as JsonObject).minor = 1;
	assert.throws(() => decode(wrongMinor), /incompatible/);
	assert.throws(() => decode({ ...clone(source), schema: "gentle-ai.review-integration.capabilities/v1" }), /schema/);
});

test("START enforces required, exact, and enum-bounded payloads", () => {
	const source = fixture<JsonObject>("start.fixture.json");
	assertRequired(decodeReviewStartV3, source, ["schema", "contract", "operation", "action", "lenses_required", "lineage_id", "state", "risk_level", "selected_lenses", "projection", "changed_files", "changed_lines", "correction_budget", "risk_reasons", "artifact_subjects"]);
	assertAdditionalProperty(decodeReviewStartV3, source);
	for (const state of Object.values(REVIEW_START_STATE)) {
		const candidate = clone(source);
		candidate.state = state;
		if (state === "reviewing") continue; // fixture is action=created, state=reviewing already requires repository_context which is present
		assert.throws(() => decodeReviewStartV3(candidate), /repository_context|state/);
	}
});

test("start/v3 transports the published selected_lenses wire contract without Pi-owned risk policy", () => {
	const captured = devFixture<JsonObject>("start-v3-zero-lens-closed.captured.json");
	const decoded = decodeReviewStartV3(captured);
	assert.equal(decoded.action, "closed");
	assert.equal(decoded.lensesRequired, false);
	assert.deepEqual(decoded.selectedLenses, []);

	for (const riskLevel of ["medium", "high"] as const) {
		const noLens = clone(captured);
		noLens.risk_level = riskLevel;
		assert.doesNotThrow(() => decodeReviewStartV3(noLens));
	}

	const nullLenses = clone(captured);
	nullLenses.selected_lenses = null;
	assert.throws(() => decodeReviewStartV3(nullLenses), /selected_lenses.*invalid length/);

	const unknownLens = clone(captured);
	unknownLens.selected_lenses = ["review-future"];
	assert.throws(() => decodeReviewStartV3(unknownLens), /selected_lenses.*unsupported/);

	const tooManyLenses = clone(captured);
	tooManyLenses.selected_lenses = ["review-risk", "review-resilience", "review-readability", "review-reliability", "review-future"];
	assert.throws(() => decodeReviewStartV3(tooManyLenses), /selected_lenses.*invalid length/);

	const duplicateLenses = clone(captured);
	duplicateLenses.selected_lenses = ["review-risk", "review-risk"];
	assert.throws(() => decodeReviewStartV3(duplicateLenses), /selected_lenses.*duplicates/);

	const wrongSchema = clone(captured);
	wrongSchema.schema = "gentle-ai.review-integration.start/v2";
	assert.throws(() => decodeReviewStartV3(wrongSchema), /schema/);

	const invalidAction = clone(captured);
	invalidAction.action = "dispatch-locally";
	assert.throws(() => decodeReviewStartV3(invalidAction), /action.*unsupported/);

	const invalidLensesRequired = clone(captured);
	invalidLensesRequired.lenses_required = "false";
	assert.throws(() => decodeReviewStartV3(invalidLensesRequired), /lenses_required/);
});

test("historical status fixture with a receipt is rejected after receipt retirement", () => {
	// This archived fixture is pinned for schema-rejection coverage only. Its
	// bytes retain the retired receipt surface and must never regain authority.
	assert.throws(() => decodeReviewStatusV3(fixture("status.fixture.json")), /receipt.*not allowed/);
});

test("projection enforces every required property and rejects additional keys", () => {
	const source = (fixture<JsonObject>("status.fixture.json").projection as JsonObject);
	assertRequired(decodeReviewProjectionV1, source, ["schema", "kind", "projection", "base_tree", "initial_review_tree", "current_candidate_tree", "paths_digest", "paths", "intended_untracked", "intended_untracked_proof", "initial_snapshot_identity", "current_snapshot_identity"]);
	assertAdditionalProperty(decodeReviewProjectionV1, source);
});

test("failure enforces exact keys, enums, and identifiers", () => {
	const source: JsonObject = {
		schema: "gentle-ai.review-integration.failure/v2",
		contract: REVIEW_INTEGRATION_CONTRACT,
		operation: "review.capture-result",
		phase: "pre_native",
		code: "gate_scope_changed",
		message: "the target scope changed since START",
		mutation_outcome: "not_started",
		authority_applicability: "current_target",
		retry_safe: true,
		replayability: "manual_action_required",
		required_inputs: [],
		next_action: "explicit-maintainer-action",
	};
	assert.equal(decodeReviewFailureV2(source).code, "gate_scope_changed");
	assertRequired(decodeReviewFailureV2, source, ["schema", "contract", "operation", "phase", "code", "message", "mutation_outcome", "authority_applicability", "retry_safe", "replayability", "required_inputs", "next_action"]);
	assertAdditionalProperty(decodeReviewFailureV2, source);
	const badCode = clone(source);
	badCode.code = "Bad-Code";
	assert.throws(() => decodeReviewFailureV2(badCode), /code/);
});

test("failure with code managed_assets_outdated decodes its continuation, degrades without one, and forbids it elsewhere", () => {
	const source: JsonObject = {
		schema: "gentle-ai.review-integration.failure/v2",
		contract: REVIEW_INTEGRATION_CONTRACT,
		operation: "review.start",
		phase: "preflight",
		code: "managed_assets_outdated",
		message: "the managed asset set is stale",
		mutation_outcome: "not_started",
		authority_applicability: "current_target",
		retry_safe: true,
		replayability: "manual_action_required",
		required_inputs: [],
		next_action: "explicit-maintainer-action",
		continuation: { operation: "sync", command: "gentle-ai sync --agent claude-code", agent: "claude-code", stale_assets: ["orchestration/claude-code.md"] },
	};
	assert.deepEqual(decodeReviewFailureV2(source).continuation, { operation: "sync", command: "gentle-ai sync --agent claude-code", agent: "claude-code", staleAssets: ["orchestration/claude-code.md"] });

	const missingCommand = clone(source);
	delete (missingCommand.continuation as JsonObject).command;
	assert.throws(() => decodeReviewFailureV2(missingCommand), /command.*required|required.*command/);

	// an older gentle-ai may emit managed_assets_outdated with no continuation
	// at all; decode must not refuse the whole envelope for that
	const missingContinuation = clone(source);
	delete missingContinuation.continuation;
	assert.equal(decodeReviewFailureV2(missingContinuation).continuation, undefined);

	const unexpectedContinuation: JsonObject = { ...clone(source), code: "gate_scope_changed" };
	assert.throws(() => decodeReviewFailureV2(unexpectedContinuation), /continuation is only valid/);

	// an envelope without continuation, on a code that does not require one, is unchanged
	const withoutContinuation = clone(source);
	withoutContinuation.code = "gate_scope_changed";
	delete withoutContinuation.continuation;
	assert.equal(decodeReviewFailureV2(withoutContinuation).continuation, undefined);
});

test("net-new decoders: consent, next-transition, and artifact-subject reject malformed payloads", () => {
	const consentSource = fixture<JsonObject>("consent.fixture.json");
	assertRequired(decodeReviewConsentV2, consentSource, ["schema", "contract", "operation", "action", "blocking", "target_identity", "projection", "risk_level", "changed_files", "changed_lines", "headline", "reason", "value", "risk_evidence", "choices", "off_path"]);
	assertAdditionalProperty(decodeReviewConsentV2, consentSource);

	const transitionSource = ((fixture<JsonObject>("status.fixture.json").next_transition) as JsonObject);
	assertRequired(decodeReviewNextTransitionV3, transitionSource, ["kind", "reason_code"]);
	assertAdditionalProperty(decodeReviewNextTransitionV3, transitionSource);

	const artifactSubjectSource = (((fixture<JsonObject>("start.fixture.json").artifact_subjects) as JsonObject[])[0]);
	assertRequired(decodeReviewArtifactSubjectV2, artifactSubjectSource, ["schema", "subject_hash", "lineage_id", "authority_revision", "target_identity", "base_tree", "candidate_tree", "changed_path_manifest_sha256", "lens", "selected_order"]);
	assertAdditionalProperty(decodeReviewArtifactSubjectV2, artifactSubjectSource);
});



test("authority repair assessment decodes eligible and unsupported statuses", () => {
	assert.equal(decodeAuthorityRepairAssessmentV1(repairAssessment("unsupported")).status, "unsupported");
	assert.equal(decodeAuthorityRepairAssessmentV1(repairAssessment("eligible")).status, "eligible");
	const missingClass = repairAssessment("eligible");
	delete missingClass.class;
	assert.throws(() => decodeAuthorityRepairAssessmentV1(missingClass), /requires class/);
});

test("repair execute-without-execution is rejected", () => {
	const executeMissingExecution: JsonObject = {
		schema: "gentle-ai.review-integration.repair/v2",
		contract: REVIEW_INTEGRATION_CONTRACT,
		operation: "review.repair",
		mode: "execute",
		assessment: repairAssessment("unsupported"),
		required_inputs: [],
	};
	assert.throws(() => decodeReviewRepairV2(executeMissingExecution), /execution/);
});

test("capabilities enforce the exact mandatory feature set while accepting a superset of advertised operations", () => {
	const source = fixture<JsonObject>("capabilities.fixture.json");
	const decode = (value: unknown) => decodeReviewCapabilitiesV2(value, executableDigest);
	const decoded = decode(source) as { mandatoryFeatures: ReadonlySet<string>; operations: ReadonlySet<string> };
	assert.equal(decoded.mandatoryFeatures.has("compact_v2_authority"), true);
	assert.equal(decoded.operations.has("review.repair"), true);

	const extraMandatory = clone(source);
	((extraMandatory.features as JsonObject).mandatory as JsonObject[]).push({ name: "risk_reasons", supported: true, requires: [] });
	assert.throws(() => decode(extraMandatory), /mandatory/);

	// operations is a superset promise: an extra advertised operation beyond the
	// required set must not be rejected.
	const extraOperation = clone(source);
	(extraOperation.operations as string[]).push("review.future_operation");
	assert.doesNotThrow(() => decode(extraOperation));

	// mandatory features must stay an exact match: a known-but-optional feature
	// name added to the mandatory list must still be rejected. This is the
	// contract boundary (unknown_mandatory: "reject") and must not regress when
	// gates/projections become additive-tolerant below.
	const extraMandatoryUnknownAddition = clone(source);
	((extraMandatoryUnknownAddition.features as JsonObject).mandatory as JsonObject[]).push({ name: "bounded_process_waits", supported: true, requires: [] });
	assert.throws(() => decode(extraMandatoryUnknownAddition), /mandatory/);
});
