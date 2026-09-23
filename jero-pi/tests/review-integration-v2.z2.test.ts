// review-integration-v2 测试第 2 段（共 2 段；夹具在 review-integration-v2-shared.ts）。
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
	devFixtureRoot, digest, executableDigest, fixture, fixtureRoot, type JsonObject
} from "./review-integration-v2-shared.ts";
import { repairAssessment, unachievableSlot } from "./review-integration-v2.test.ts";

test("next_transition stop refuses an unachievable slot whose withdraw arguments disagree with its identity", () => {
	const stop: JsonObject = { kind: "stop", reason_code: "unachievable_lens_slot", unachievable_lens_slots: [unachievableSlot()] };
	const drift = (name: string, value: string): JsonObject => {
		const drifted = unachievableSlot();
		const withdraw = drifted.withdraw as JsonObject;
		withdraw.arguments = (withdraw.arguments as unknown[]).map((argument) => (argument as JsonObject).name === name ? { ...(argument as JsonObject), value } : argument);
		return drifted;
	};
	for (const [name, value] of [["request-hash", `sha256:${"b".repeat(64)}`], ["target", `sha256:${"c".repeat(64)}`], ["lineage", "review-fixture-drifted"], ["expected-revision", `sha256:${"d".repeat(64)}`]] as const) {
		assert.throws(() => decodeReviewNextTransitionV3({ ...stop, unachievable_lens_slots: [drift(name, value)] }), new RegExp(`${name} does not match`), name);
	}
	// the pristine fixture still decodes with both renderings agreeing
	assert.doesNotThrow(() => decodeReviewNextTransitionV3(stop));
});

// gentle-pi#822: identity arguments appear exactly once, and the rendered
// command is an exact, ordered rendering of every validated provider token.
// Substring checks would accept a missing non-identity token, repeated command,
// suffix, or shell payload despite the command no longer naming this slot alone.
test("next_transition stop refuses duplicate identities and non-exact withdraw commands", () => {
	const stop: JsonObject = { kind: "stop", reason_code: "unachievable_lens_slot", unachievable_lens_slots: [unachievableSlot()] };
	const duplicated = unachievableSlot();
	const duplicatedWithdraw = duplicated.withdraw as JsonObject;
	duplicatedWithdraw.arguments = [...(duplicatedWithdraw.arguments as unknown[]), { name: "lineage", value: "review-fixture-smuggled", token: "--lineage=review-fixture-smuggled" }];
	assert.throws(() => decodeReviewNextTransitionV3({ ...stop, unachievable_lens_slots: [duplicated] }), /withdraw\.arguments lineage must appear exactly once/);

	const canonical = `gentle-ai review capture-unachievable --lineage=review-fixture --expected-revision=${digest} --target=${digest} --repository-context=rctx1_${"e".repeat(64)} --request-hash=${digest} --withdraw=true`;
	for (const [name, command] of [
		["omitted token", canonical.replace(" --withdraw=true", "")],
		["duplicate command", `gentle-ai review capture-unachievable ${canonical}`],
		["extra suffix", `${canonical} --surplus=true`],
		["shell payload", `${canonical} && printf injected`],
	] as const) {
		const malformed = unachievableSlot();
		(malformed.withdraw as JsonObject).command = command;
		assert.throws(() => decodeReviewNextTransitionV3({ ...stop, unachievable_lens_slots: [malformed] }), /withdraw\.command must exactly render/, name);
	}
	assert.doesNotThrow(() => decodeReviewNextTransitionV3(stop));
});

// gentle-pi#822 (CodeRabbit finding): withdrawal is a narrowly scoped, runnable
// retraction. Its one affirmative flag is part of the exact native vector, not
// just another provider-defined argument that a malformed STATUS can omit or
// negate while still rendering a plausible command.
test("next_transition stop requires exactly one canonical --withdraw=true argument", () => {
	const stop: JsonObject = { kind: "stop", reason_code: "unachievable_lens_slot", unachievable_lens_slots: [unachievableSlot()] };
	const canonicalCommand = (slot: JsonObject): string => {
		const withdraw = slot.withdraw as JsonObject;
		return `gentle-ai review capture-unachievable ${(withdraw.arguments as JsonObject[]).map((argument) => String(argument.token)).join(" ")}`;
	};

	const omitted = unachievableSlot();
	const omittedWithdraw = omitted.withdraw as JsonObject;
	omittedWithdraw.arguments = (omittedWithdraw.arguments as JsonObject[]).filter((argument) => argument.name !== "withdraw");
	omittedWithdraw.command = canonicalCommand(omitted);
	assert.throws(() => decodeReviewNextTransitionV3({ ...stop, unachievable_lens_slots: [omitted] }), /withdraw must appear exactly once/);

	const falseValue = unachievableSlot();
	const falseWithdraw = falseValue.withdraw as JsonObject;
	falseWithdraw.arguments = (falseWithdraw.arguments as JsonObject[]).map((argument) => argument.name === "withdraw"
		? { ...argument, value: "false", token: "--withdraw=false" }
		: argument);
	falseWithdraw.command = canonicalCommand(falseValue);
	assert.throws(() => decodeReviewNextTransitionV3({ ...stop, unachievable_lens_slots: [falseValue] }), /withdraw must be true/);

	const noncanonicalToken = unachievableSlot();
	const tokenWithdraw = noncanonicalToken.withdraw as JsonObject;
	tokenWithdraw.arguments = (tokenWithdraw.arguments as JsonObject[]).map((argument) => argument.name === "withdraw"
		? { ...argument, token: "--withdraw true" }
		: argument);
	tokenWithdraw.command = canonicalCommand(noncanonicalToken);
	assert.throws(() => decodeReviewNextTransitionV3({ ...stop, unachievable_lens_slots: [noncanonicalToken] }), /token must exactly render/);

	const duplicate = unachievableSlot();
	const duplicateWithdraw = duplicate.withdraw as JsonObject;
	duplicateWithdraw.arguments = [...duplicateWithdraw.arguments as JsonObject[], { name: "withdraw", value: "true", token: "--withdraw=true" }];
	duplicateWithdraw.command = canonicalCommand(duplicate);
	assert.throws(() => decodeReviewNextTransitionV3({ ...stop, unachievable_lens_slots: [duplicate] }), /withdraw must appear exactly once/);
});

// gentle-pi#822 (CodeRabbit finding): Go bounds the CAPTURE_UNACHIEVABLE detail at 512 UTF-8 bytes (native-review-cli.ts enforces the same limit when declaring), so the transition decoder mirrors that bound — measured in bytes, not UTF-16 code units — and a STATUS stop can never carry a detail this client would have refused to declare.
test("next_transition stop bounds an unachievable slot detail at 512 UTF-8 bytes", () => {
	const stop: JsonObject = { kind: "stop", reason_code: "unachievable_lens_slot", unachievable_lens_slots: [unachievableSlot()] };
	// exactly 512 one-byte characters still decodes
	assert.equal(decodeReviewNextTransitionV3({ ...stop, unachievable_lens_slots: [unachievableSlot({ detail: "a".repeat(512) })] }).unachievableLensSlots?.[0]?.detail, "a".repeat(512));
	// exactly 512 bytes of two-byte characters still decodes: 256 × 2
	assert.equal(decodeReviewNextTransitionV3({ ...stop, unachievable_lens_slots: [unachievableSlot({ detail: "é".repeat(256) })] }).unachievableLensSlots?.[0]?.detail, "é".repeat(256));
	// 257 two-byte characters are 514 bytes
	assert.throws(() => decodeReviewNextTransitionV3({ ...stop, unachievable_lens_slots: [unachievableSlot({ detail: "é".repeat(257) })] }), /detail exceeds 512 bytes/);
	// 171 three-byte characters are 513 bytes
	assert.throws(() => decodeReviewNextTransitionV3({ ...stop, unachievable_lens_slots: [unachievableSlot({ detail: "世".repeat(171) })] }), /detail exceeds 512 bytes/);
	// an absent detail still decodes as undefined
	assert.equal(decodeReviewNextTransitionV3(stop).unachievableLensSlots?.[0]?.detail, undefined);
});

export function approvedAcknowledgementTransition(): JsonObject {
	return {
		kind: "execute",
		reason_code: "approved_acknowledgement_required",
		execute: {
			operation: "review.acknowledge-approved",
			command: "gentle-ai review acknowledge-approved --provider-vector",
			arguments: [
				{ name: "cwd", value: "/provider/repository", token: "--cwd=/provider/repository" },
				{ name: "lineage", value: "review-fixture", token: "--lineage=review-fixture" },
				{ name: "target", value: digest, token: `--target=${digest}` },
				{ name: "expected-revision", value: digest, token: `--expected-revision=${digest}` },
				{ name: "token", value: "provider-issued-once", token: "--token=provider-issued-once" },
			],
			preconditions: [{ name: "state", value: "approved", token: "--state=approved" }],
			binding: { lineage_id: "review-fixture", target_identity: digest, revision: digest },
		},
	};
}

test("acknowledgement execute rejects decoy bindings, closed-vector drift, and malformed approval", () => {
	const valid = approvedAcknowledgementTransition();
	assert.equal(decodeReviewNextTransitionV3(valid).execute?.operation, "review.acknowledge-approved");
	const cases: Array<[string, (candidate: JsonObject) => void]> = [
		["decoy target", (candidate) => { const argument = ((candidate.execute as JsonObject).arguments as JsonObject[])[2]!; argument.value = `sha256:${"b".repeat(64)}`; argument.token = `--target=${argument.value}`; }],
		["mismatched expected revision", (candidate) => { const argument = ((candidate.execute as JsonObject).arguments as JsonObject[])[3]!; argument.value = `sha256:${"c".repeat(64)}`; argument.token = `--expected-revision=${argument.value}`; }],
		["wrong argument order", (candidate) => { ((candidate.execute as JsonObject).arguments as JsonObject[]).reverse(); }],
		["wrong argument name", (candidate) => { const argument = ((candidate.execute as JsonObject).arguments as JsonObject[])[0]!; argument.name = "repository"; argument.token = `--repository=${argument.value}`; }],
		["malformed approved precondition", (candidate) => { ((candidate.execute as JsonObject).preconditions as JsonObject[])[0]!.value = "burned"; }],
		["token value mismatch", (candidate) => { ((candidate.execute as JsonObject).arguments as JsonObject[])[4]!.token = "--token=other"; }],
	];
	for (const [name, mutate] of cases) {
		const candidate = clone(valid);
		mutate(candidate);
		assert.throws(() => decodeReviewNextTransitionV3(candidate), /acknowledgement|arguments|preconditions|binding/, name);
	}
});

test("repair decodes a committed execute result and rejects a non-eligible preflight carrying provider_inputs", () => {
	const executed: JsonObject = {
		schema: "gentle-ai.review-integration.repair/v2",
		contract: REVIEW_INTEGRATION_CONTRACT,
		operation: "review.repair",
		mode: "execute",
		assessment: repairAssessment("eligible"),
		required_inputs: [],
		execution: {
			status: "committed",
			class: "legacy_v1_historical_alias",
			lineage_id: "review-legacy-fixture",
			revision: digest,
			chain_identity: digest,
			cause: "unsupported_historical_v1_operation_alias",
			disposition: "quarantine-approved-historical-alias",
			assessment_digest: digest,
			request_digest: digest,
			record_identity: digest,
		},
	};
	assert.equal(decodeReviewRepairV2(executed).execution?.status, "committed");

	const nonEligibleWithInputs: JsonObject = {
		schema: "gentle-ai.review-integration.repair/v2",
		contract: REVIEW_INTEGRATION_CONTRACT,
		operation: "review.repair",
		mode: "preflight",
		assessment: repairAssessment("unsupported"),
		provider_inputs: {
			class: "legacy_v1_historical_alias",
			lineage_id: "review-legacy-fixture",
			expected_revision: digest,
			cause: "unsupported_historical_v1_operation_alias",
			disposition: "quarantine-approved-historical-alias",
			repository_binding: digest,
			authorization_schema: "gentle-ai.review-repair-authorization/v1",
		},
		required_inputs: [],
	};
	assert.throws(() => decodeReviewRepairV2(nonEligibleWithInputs), /provider_inputs is only valid/);
});

test("artifact-subject accepts an optional correction_target_identity", () => {
	const source = ((fixture<JsonObject>("start.fixture.json").artifact_subjects) as JsonObject[])[0];
	const withCorrection = clone(source);
	withCorrection.correction_target_identity = digest;
	const decoded = decodeReviewArtifactSubjectV2(withCorrection);
	assert.equal(decoded.correctionTargetIdentity, digest);
	assert.equal(decodeReviewArtifactSubjectV2(source).correctionTargetIdentity, undefined);
});

test("repair eligible preflight with wrong required_inputs order is rejected", () => {
	const wrongOrder: JsonObject = {
		schema: "gentle-ai.review-integration.repair/v2",
		contract: REVIEW_INTEGRATION_CONTRACT,
		operation: "review.repair",
		mode: "preflight",
		assessment: repairAssessment("eligible"),
		provider_inputs: {
			class: "legacy_v1_historical_alias",
			lineage_id: "review-legacy-fixture",
			expected_revision: digest,
			cause: "unsupported_historical_v1_operation_alias",
			disposition: "quarantine-approved-historical-alias",
			repository_binding: digest,
			authorization_schema: "gentle-ai.review-repair-authorization/v1",
		},
		required_inputs: ["reason", "actor", "maintainer_authorization"],
	};
	assert.throws(() => decodeReviewRepairV2(wrongOrder), /required_inputs/);
});

// Three decode defects the after-bench found by driving the real v2.2.2 binary.
// Every native call exited 0 and authority advanced; Pi threw locally on the
// RESPONSE. The mirrored fixture never caught them because it only exercises
// the `collect` transition kind, so no `execute` payload was ever decoded.
//
// The authority here is contracts/review-integration/v1/schemas/status-v2.schema.json
// $defs.transition_execution, which declares optional `command`,
// `selector_arguments`, and `artifacts`, and a `binding` with NO declared
// properties and no required list -- an OPEN object. Pi had closed execute to
// `command` alone and binding to three keys, making it stricter than the
// contract it implements.

test("next_transition.execute accepts the optional selector_arguments and artifacts the schema declares", () => {
	const base = {
		kind: "execute" as const,
		reason_code: "fresh_target_ready",
		execute: {
			operation: "review.start",
			command: "gentle-ai review start --lineage=review-96f29cbd865e77a9",
			arguments: [{ name: "lineage", value: "review-96f29cbd865e77a9", token: "--lineage=review-96f29cbd865e77a9" }],
			preconditions: [{ name: "target_identity", value: "sha256:" + "9".repeat(64) }],
			binding: { target_identity: "sha256:" + "9".repeat(64) },
		},
	};

	assert.doesNotThrow(() => decodeReviewNextTransitionV3(base));
	assert.doesNotThrow(() => decodeReviewNextTransitionV3({ ...base, execute: { ...base.execute, artifacts: [{ name: "start-record", path: "review-start.json" }] } }));
	assert.doesNotThrow(() => decodeReviewNextTransitionV3({ ...base, execute: { ...base.execute, selector_arguments: [{ name: "projection", value: "workspace", token: "--projection=workspace" }] } }));
});

// gentle-pi#311 P4-roles: the two Go-owned non-lens provider role capture
// operations render SELF-CONTAINED vectors (binding tokens + --agent=pi
// --execute=true). Their schemas are pinned, and a submission descriptor on
// either one is a contract violation because it would hand the caller a way
// to author the verdict.
test("next_transition decodes the self-contained provider role capture vectors strictly", () => {
	const roleInput = (name: string, captureOperation: string, schema: string, extra: Record<string, unknown> = {}) => ({
		kind: "collect",
		reason_code: "provider_refuter_required",
		collect: { inputs: [{
			name,
			schema,
			capture_operation: captureOperation,
			arguments: [
				{ name: "lineage", value: "review-fixture", token: "--lineage=review-fixture" },
				{ name: "expected-revision", value: digest, token: `--expected-revision=${digest}` },
				{ name: "target", value: digest, token: `--target=${digest}` },
				{ name: "repository-context", value: `rctx1_${"c".repeat(64)}`, token: `--repository-context=rctx1_${"c".repeat(64)}` },
				{ name: "agent", value: "pi", token: "--agent=pi" },
				{ name: "execute", value: "true", token: "--execute=true" },
			],
			...extra,
		}] },
	});

	const decodeRoleTransition = (value: unknown) => decodeReviewNextTransitionV3(value, { v5: true });
	const refuter = roleInput("provider_refuter", "review.capture-refuter", "https://gentle-ai.dev/schema/review/refuter/v1");
	const decodedRefuter = decodeRoleTransition(refuter);
	assert.equal(decodedRefuter.collect?.inputs[0]?.captureOperation, "review.capture-refuter");
	assert.equal(decodedRefuter.collect?.inputs[0]?.arguments.at(-1)?.token, "--execute=true");

	assert.throws(
		() => decodeRoleTransition(roleInput("provider_refuter", "review.capture-refuter", "https://gentle-ai.dev/schema/review/reviewer/v1")),
		/schema must be https:\/\/gentle-ai\.dev\/schema\/review\/refuter\/v1/,
	);
	assert.throws(
		() => decodeRoleTransition(roleInput("provider_refuter", "review.capture-refuter", "https://gentle-ai.dev/schema/review/refuter/v1", {
			submission: { operation_token: "capture-refuter", argument_tokens: ["--input={{value}}"], values: [{ slot: "{{value}}", domain: "artifact-path", substitution_location: 0 }] },
		})),
		/submission is not allowed on the self-contained/,
	);

	const validator = roleInput("provider_targeted_validator", "review.capture-validation", "https://gentle-ai.dev/schema/review/validator/v1");
	assert.throws(
		() => decodeRoleTransition(validator),
		/validation_request is required/,
	);

	assert.throws(
		() => decodeRoleTransition(roleInput("provider_targeted_validator", "review.capture-validation", "https://gentle-ai.dev/schema/review/refuter/v1")),
		/schema must be https:\/\/gentle-ai\.dev\/schema\/review\/validator\/v1/,
	);
});

test("v5 targeted-validator collect inputs carry the exact provider-owned validation request", () => {
	const requestHash = `sha256:${"a".repeat(64)}`;
	const expectedRevision = `sha256:${"b".repeat(64)}`;
	const targetIdentity = `sha256:${"c".repeat(64)}`;
	const correctionTargetIdentity = `sha256:${"d".repeat(64)}`;
	const correctionPathsDigest = `sha256:${"e".repeat(64)}`;
	const validationRequest = {
		schema: "gentle-ai.review-targeted-validation-request/v1",
		request_hash: requestHash,
		lineage_id: "review-fixture",
		expected_revision: expectedRevision,
		target_identity: targetIdentity,
		fix_finding_ids: ["R1-001"],
		policy_content: "Gentle AI native bounded review policy.",
		fix_findings: [{
			id: "R1-001",
			lens: "risk",
			location: "selected.txt:1",
			severity: "BLOCKER",
			claim: "the selected relay input must be corrected before delivery",
			proof_refs: ["selected.txt:1"],
			evidence_class: "deterministic",
			causal_disposition: "introduced",
		}],
		fix_classifications: [{
			finding_id: "R1-001",
			class: "deterministic",
			causal_disposition: "introduced",
			proof: "selected.txt:1",
		}],
		projection: "workspace",
		correction_candidate_tree: "f".repeat(40),
		correction_target_identity: correctionTargetIdentity,
		correction_paths: ["selected.txt"],
		correction_paths_digest: correctionPathsDigest,
	};
	const input = {
		name: "provider_targeted_validator",
		schema: "https://gentle-ai.dev/schema/review/validator/v1",
		capture_operation: "review.capture-validation",
		arguments: [
			{ name: "lineage", value: "review-fixture", token: "--lineage=review-fixture" },
			{ name: "expected-revision", value: expectedRevision, token: `--expected-revision=${expectedRevision}` },
			{ name: "target", value: correctionTargetIdentity, token: `--target=${correctionTargetIdentity}` },
			{ name: "repository-context", value: `rctx1_${"f".repeat(64)}`, token: `--repository-context=rctx1_${"f".repeat(64)}` },
			{ name: "request-hash", value: requestHash, token: `--request-hash=${requestHash}` },
			{ name: "agent", value: "pi", token: "--agent=pi" },
			{ name: "execute", value: "true", token: "--execute=true" },
		],
		validation_request: validationRequest,
	};
	const transition = { kind: "collect" as const, reason_code: "targeted_validation_required", collect: { inputs: [input] } };
	const decoded = decodeReviewNextTransitionV3(transition, { v5: true });
	const decodedRequest = decoded.collect?.inputs[0]?.validationRequest;
	assert.equal(decodedRequest?.requestHash, requestHash);
	assert.equal(decodedRequest?.correctionTargetIdentity, correctionTargetIdentity);
	assert.deepEqual(decodedRequest?.correctionPaths, ["selected.txt"]);
	assert.equal(decodedRequest?.policyContent, validationRequest.policy_content);
	assert.deepEqual(decodedRequest?.fixFindings, [{
		id: "R1-001",
		lens: "risk",
		location: "selected.txt:1",
		severity: "BLOCKER",
		claim: "the selected relay input must be corrected before delivery",
		proofRefs: ["selected.txt:1"],
		evidenceClass: "deterministic",
		causalDisposition: "introduced",
	}]);
	assert.deepEqual(decodedRequest?.fixClassifications, [{
		findingId: "R1-001",
		class: "deterministic",
		causalDisposition: "introduced",
		proof: "selected.txt:1",
	}]);
	assert.deepEqual(decoded.collect?.inputs[0]?.arguments, input.arguments, "provider-rendered arguments must remain unchanged");

	const missingRequest = clone(transition);
	delete (missingRequest.collect.inputs[0] as JsonObject).validation_request;
	assert.throws(() => decodeReviewNextTransitionV3(missingRequest, { v5: true }), /validation_request is required/);

	const mismatchedRequestHash = clone(transition);
	((mismatchedRequestHash.collect.inputs[0] as JsonObject).validation_request as JsonObject).request_hash = `sha256:${"0".repeat(64)}`;
	assert.throws(() => decodeReviewNextTransitionV3(mismatchedRequestHash, { v5: true }), /request-hash/);

	const refuter = clone(transition);
	const refuterInput = refuter.collect.inputs[0] as JsonObject;
	refuterInput.name = "provider_refuter";
	refuterInput.schema = "https://gentle-ai.dev/schema/review/refuter/v1";
	refuterInput.capture_operation = "review.capture-refuter";
	assert.throws(() => decodeReviewNextTransitionV3(refuter, { v5: true }), /validation_request.*targeted-validator/);

	const malformedRequest = clone(transition);
	((malformedRequest.collect.inputs[0] as JsonObject).validation_request as JsonObject).unadvertised = true;
	assert.throws(() => decodeReviewNextTransitionV3(malformedRequest, { v5: true }), /not allowed/);

	const weakenedRequest = clone(transition);
	((weakenedRequest.collect.inputs[0] as JsonObject).validation_request as JsonObject).policy_content = "";
	assert.throws(() => decodeReviewNextTransitionV3(weakenedRequest, { v5: true }), /policy_content/);
});

test("status.frozen carries the optional frozen manifest digest", () => {
	const current = devFixture<JsonObject>("status-v5-repository-context.captured.json");
	delete current.receipt;
	if (current.action === "finalize") {
		current.action = "stop";
		delete current.next_transition;
		delete current.forecast;
	}
	assert.equal(typeof (current.frozen as JsonObject | undefined)?.tier, "string", "the captured status carries frozen");
	const digest = `sha256:${"ab".repeat(32)}`;
	(current.frozen as JsonObject).changed_path_manifest_sha256 = digest;
	assert.equal(decodeReviewStatusV3(current).frozen?.changedPathManifestSha256, digest);
	(current.frozen as JsonObject).changed_path_manifest_sha256 = "not-a-digest";
	assert.throws(() => decodeReviewStatusV3(current), /changed_path_manifest_sha256/);
	delete (current.frozen as JsonObject).changed_path_manifest_sha256;
	assert.equal(decodeReviewStatusV3(current).frozen?.changedPathManifestSha256, undefined);
});

test("a capture-result collect input decodes without changed_path_manifest, which the artifact subject digest already binds", () => {
	const status = fixture<JsonObject>("status.fixture.json");
	const transition = clone((status.next_transition ?? {}) as JsonObject);
	const inputs = ((transition.collect as JsonObject | undefined)?.inputs ?? []) as JsonObject[];
	const captureInput = inputs.find((input) => input.capture_operation === "review.capture-result");
	assert.ok(captureInput, "the status fixture carries a capture-result collect input");
	assert.doesNotThrow(() => decodeReviewNextTransitionV3(transition, { v5: true, v6: true }), "with the manifest");
	delete captureInput.changed_path_manifest;
	const decoded = decodeReviewNextTransitionV3(transition, { v5: true, v6: true });
	const decodedInput = decoded.collect?.inputs.find((input) => input.captureOperation === "review.capture-result");
	assert.ok(decodedInput?.artifactSubject?.changedPathManifestSha256, "the digest on the artifact subject is the binding");
	assert.equal(decodedInput?.changedPathManifest, undefined);
	delete captureInput.artifact_subject;
	assert.throws(() => decodeReviewNextTransitionV3(transition, { v5: true, v6: true }), /requires artifact_subject, base_tree, and candidate_tree/);
});

test("status enforces authority/frozen/receipt conditionals and decodes the required repair field", () => {
	const current = devFixture<JsonObject>("status-v5-repository-context.captured.json");
	delete current.receipt;
	if (current.action === "finalize") {
		current.action = "stop";
		delete current.next_transition;
		delete current.forecast;
	}
	const decoded = decodeReviewStatusV3(current);
	assert.equal(decoded.repair.status, "unsupported");
	assert.equal(decoded.authority?.state, "reviewing");
	for (const action of ["collect", "execute"]) {
		const projected = clone(current);
		projected.action = action;
		assert.equal(decodeReviewStatusV3(projected).action, action, "a live transaction's root action names its mandated transition kind");
	}

	const missingAuthority = clone(current);
	delete missingAuthority.authority;
	assert.throws(() => decodeReviewStatusV3(missingAuthority), /requires authority/);

	const compactMissingFrozen = clone(current);
	delete compactMissingFrozen.frozen;
	assert.throws(() => decodeReviewStatusV3(compactMissingFrozen), /requires frozen/);
});

test("next_transition.execute.binding stays open, as its schema declares no properties", () => {
	const withContext = {
		kind: "execute" as const,
		reason_code: "fresh_target_ready",
		execute: {
			operation: "review.start",
			arguments: [{ name: "lineage", value: "review-fixture", token: "--lineage=review-fixture" }],
			preconditions: [{ name: "target_identity", value: `sha256:${"8".repeat(64)}` }],
			binding: { target_identity: `sha256:${"8".repeat(64)}`, repository_context: `rctx1_${"c".repeat(64)}` },
		},
	};
	assert.doesNotThrow(() => decodeReviewNextTransitionV3(withContext));
});

