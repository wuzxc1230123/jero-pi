// 重平衡分片：自 review-integration-v2.test.ts 按顶层语句边界对半机械平移（语义零改动）。
// node --test 只在文件间并行；重用例扎堆单文件会抬高整套件并行的下限。

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

test("capabilities gates and projections accept an additive superset beyond the required floor", () => {
	const source = fixture<JsonObject>("capabilities.fixture.json");
	const decode = (value: unknown) => decodeReviewCapabilitiesV2(value, executableDigest);

	const extraGate = clone(source);
	(extraGate.gates as string[]).push("future-gate");
	const decodedExtraGate = decode(extraGate) as { gates: ReadonlySet<string> };
	assert.equal(decodedExtraGate.gates.has("future-gate"), false, "an unknown advertised gate must not leak into internal use");
	for (const gate of ["post-apply", "pre-commit", "pre-push", "pre-pr", "release"]) {
		assert.equal(decodedExtraGate.gates.has(gate), true, gate);
	}
	assert.equal(decodedExtraGate.gates.size, 5);

	const extraProjection = clone(source);
	(extraProjection.projections as string[]).push("future-projection");
	const decodedExtraProjection = decode(extraProjection) as { projections: ReadonlySet<string> };
	assert.equal(decodedExtraProjection.projections.has("future-projection"), false, "an unknown advertised projection must not leak into internal use");
	for (const projection of ["staged", "workspace"]) {
		assert.equal(decodedExtraProjection.projections.has(projection), true, projection);
	}
	assert.equal(decodedExtraProjection.projections.size, 2);
});

test("capabilities gates and projections still enforce the required floor", () => {
	const source = fixture<JsonObject>("capabilities.fixture.json");
	const decode = (value: unknown) => decodeReviewCapabilitiesV2(value, executableDigest);

	const missingGate = clone(source);
	missingGate.gates = (missingGate.gates as string[]).filter((gate) => gate !== "release");
	assert.throws(() => decode(missingGate), /gates/);

	const missingProjection = clone(source);
	missingProjection.projections = (missingProjection.projections as string[]).filter((projection) => projection !== "workspace");
	assert.throws(() => decode(missingProjection), /projections/);
});

test("START independently binds base/candidate tree and the target-mode overlay pair", () => {
	const source = fixture<JsonObject>("start.fixture.json");
	const decoded = decodeReviewStartV3(source);
	assert.equal(decoded.baseTree, source.base_tree);
	assert.equal(decoded.candidateTree, source.candidate_tree);
	assert.equal(decoded.targetMode, undefined, "the fixture never sets target_mode");

	const partialOverlay = clone(source);
	delete partialOverlay.target_identity;
	(partialOverlay as JsonObject).target_mode = "base-workspace-overlay";
	assert.throws(() => decodeReviewStartV3(partialOverlay), /target_mode.*target_identity|together/);

	const droppedManifest = clone(source);
	delete droppedManifest.changed_path_manifest;
	assert.throws(() => decodeReviewStartV3(droppedManifest), /selected_lenses|changed_path_manifest/);

	const manifestWithoutTrees = clone(source);
	delete manifestWithoutTrees.base_tree;
	delete manifestWithoutTrees.candidate_tree;
	delete manifestWithoutTrees.selected_lenses;
	(manifestWithoutTrees as JsonObject).selected_lenses = [];
	assert.throws(() => decodeReviewStartV3(manifestWithoutTrees), /changed_path_manifest/);
});

test("failure context accepts scope_change or binding_revision but rejects both or neither", () => {
	const base: JsonObject = {
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
		required_inputs: ["predecessor_lineage_id", "expected_predecessor_revision", "successor_lineage_id", "disposition", "reason", "actor"],
		next_action: "explicit-maintainer-action",
		context: {
			binding_revision: { expected: digest, current: "" },
		},
	};
	const decoded = decodeReviewFailureV2(base);
	assert.equal(decoded.context?.bindingRevision?.current, "");

	const neither = clone(base);
	neither.context = {};
	assert.throws(() => decodeReviewFailureV2(neither), /exactly one/);

	const both = clone(base);
	both.context = { binding_revision: { expected: digest, current: digest }, scope_change: (both.context as JsonObject) };
	assert.throws(() => decodeReviewFailureV2(both), /exactly one|not allowed/);
});

test("consent rejects a swapped choice order, invalid answer domain, or invocation outside the frozen target", () => {
	const source = fixture<JsonObject>("consent.fixture.json");
	const swapped = clone(source);
	swapped.choices = [(source.choices as JsonObject[])[1], (source.choices as JsonObject[])[0]];
	assert.throws(() => decodeReviewConsentV2(swapped), /answer/);

	const badAnswer = clone(source);
	(badAnswer.choices as JsonObject[])[0].answer = "yes";
	assert.throws(() => decodeReviewConsentV2(badAnswer), /answer/);

	const badInvocation = clone(source);
	(badInvocation.choices as JsonObject[])[0].invocation = "gentle-ai review start --contract gentle-ai.review-integration/v1 --consent granted";
	assert.throws(() => decodeReviewConsentV2(badInvocation), /invocation/);

	const differentTarget = clone(source);
	(differentTarget.choices as JsonObject[])[0].invocation = String((differentTarget.choices as JsonObject[])[0].invocation)
		.replace(String(differentTarget.target_identity), `sha256:${"b".repeat(64)}`);
	assert.throws(() => decodeReviewConsentV2(differentTarget), /target|invocation/);
});

test("next_transition decodes an execute variant and rejects a stop that carries a transition", () => {
	const execute: JsonObject = {
		kind: "execute",
		reason_code: "fresh_target_ready",
		execute: {
			operation: "review.start",
			arguments: [{ name: "lineage", value: "review-fixture", token: "--lineage=review-fixture" }],
			preconditions: [{ name: "clean", value: "true" }],
			binding: { target_identity: digest },
		},
	};
	const decoded = decodeReviewNextTransitionV3(execute);
	assert.equal(decoded.execute?.operation, "review.start");
	assert.equal(decoded.execute?.arguments[0]?.token, "--lineage=review-fixture");

	const stopWithExecute = clone(execute);
	stopWithExecute.kind = "stop";
	assert.throws(() => decodeReviewNextTransitionV3(stopWithExecute), /stop cannot carry/);
});

// gentle-pi#627: gentle-ai reports a stale managed-asset set as a typed stop
// carrying the exact `gentle-ai sync` invocation that resolves it.
export function managedAssetsContinuation(overrides: Partial<JsonObject> = {}): JsonObject {
	return { operation: "sync", command: "gentle-ai sync --agent claude-code", agent: "claude-code", stale_assets: ["orchestration/claude-code.md"], ...overrides };
}

test("next_transition stop decodes a managed_assets_outdated continuation and rejects a malformed one", () => {
	const stop: JsonObject = { kind: "stop", reason_code: "managed_assets_outdated", continuation: managedAssetsContinuation() };
	const decoded = decodeReviewNextTransitionV3(stop);
	assert.deepEqual(decoded.continuation, { operation: "sync", command: "gentle-ai sync --agent claude-code", agent: "claude-code", staleAssets: ["orchestration/claude-code.md"] });

	const bare: JsonObject = { kind: "stop", reason_code: "managed_assets_outdated", continuation: { operation: "sync", command: "gentle-ai sync" } };
	assert.deepEqual(decodeReviewNextTransitionV3(bare).continuation, { operation: "sync", command: "gentle-ai sync" });

	const missingCommand = clone(stop);
	delete (missingCommand.continuation as JsonObject).command;
	assert.throws(() => decodeReviewNextTransitionV3(missingCommand), /command.*required|required.*command/);

	const emptyCommand = clone(stop);
	(emptyCommand.continuation as JsonObject).command = "";
	assert.throws(() => decodeReviewNextTransitionV3(emptyCommand), /command/);

	// an older gentle-ai may emit this stop with no continuation at all; decode
	// must not refuse the whole envelope for that
	const missingForReasonCode = { kind: "stop", reason_code: "managed_assets_outdated" };
	assert.equal(decodeReviewNextTransitionV3(missingForReasonCode).continuation, undefined);

	const unexpectedOnOtherReasonCode = { kind: "stop", reason_code: "rdd_disabled", continuation: managedAssetsContinuation() };
	assert.throws(() => decodeReviewNextTransitionV3(unexpectedOnOtherReasonCode), /continuation is only valid/);

	// envelopes without continuation stay unchanged
	const plainStop = decodeReviewNextTransitionV3({ kind: "stop", reason_code: "rdd_disabled" });
	assert.equal(plainStop.continuation, undefined);
});

// gentle-pi#638: after the host relay declares a selected lens slot
// unachievable through the native capture-unachievable verb, gentle-ai's
// STATUS stops with reason_code unachievable_lens_slot and carries one entry
// per declared slot, each naming the complete withdraw command
// (contracts/review-integration/v2/schemas/status-v7.schema.json, the stop
// variant). A restart that never saw the collect offer must still be able to
// retract the declaration from the stop alone, so the withdraw binding is
// decoded, never dropped.
test("next_transition stop decodes unachievable_lens_slots and their withdraw bindings only on that reason code", () => {
	const stop: JsonObject = { kind: "stop", reason_code: "unachievable_lens_slot", unachievable_lens_slots: [unachievableSlot()] };
	const decoded = decodeReviewNextTransitionV3(stop);
	assert.equal(decoded.kind, "stop");
	assert.equal(decoded.reasonCode, "unachievable_lens_slot");
	const slot = decoded.unachievableLensSlots?.[0];
	assert.equal(slot?.lens, "review-risk");
	assert.equal(slot?.selectedOrder, 0);
	assert.equal(slot?.subjectHash, digest);
	assert.equal(slot?.reason, "relay_transport_bound_exceeded");
	assert.equal(slot?.detail, undefined);
	assert.equal(slot?.withdraw.operation, "review.capture-unachievable");
	assert.deepEqual(slot?.withdraw.arguments.map((argument) => argument.token), ["--lineage=review-fixture", `--expected-revision=${digest}`, `--target=${digest}`, `--repository-context=rctx1_${"e".repeat(64)}`, `--request-hash=${digest}`, "--withdraw=true"]);
	assert.equal(slot?.withdraw.binding.targetIdentity, digest);
	assert.equal(slot?.withdraw.command, `gentle-ai review capture-unachievable --lineage=review-fixture --expected-revision=${digest} --target=${digest} --repository-context=rctx1_${"e".repeat(64)} --request-hash=${digest} --withdraw=true`);

	// detail is the one optional field the schema declares
	const detailed = decodeReviewNextTransitionV3({ ...stop, unachievable_lens_slots: [unachievableSlot({ detail: "killed after 2256004ms against a 2256000ms relay bound" })] });
	assert.equal(detailed.unachievableLensSlots?.[0]?.detail, "killed after 2256004ms against a 2256000ms relay bound");

	// malformed entries are refused: a negative selected_order, a slot missing
	// its withdraw form, a foreign withdraw operation, or an empty array
	assert.throws(() => decodeReviewNextTransitionV3({ ...stop, unachievable_lens_slots: [unachievableSlot({ selected_order: -1 })] }), /selected_order/);
	const withoutWithdraw = unachievableSlot();
	delete withoutWithdraw.withdraw;
	assert.throws(() => decodeReviewNextTransitionV3({ ...stop, unachievable_lens_slots: [withoutWithdraw] }), /withdraw.*required|required.*withdraw/);
	assert.throws(() => decodeReviewNextTransitionV3({ ...stop, unachievable_lens_slots: [unachievableSlot({ withdraw: { ...(unachievableSlot().withdraw as JsonObject), operation: "review.capture-result" } })] }), /operation/);
	assert.throws(() => decodeReviewNextTransitionV3({ ...stop, unachievable_lens_slots: [] }), /length/);

	// the slots are only valid on their own exact stop reason code
	assert.throws(() => decodeReviewNextTransitionV3({ kind: "stop", reason_code: "rdd_disabled", unachievable_lens_slots: [unachievableSlot()] }), /unachievable_lens_slots is only valid/);
	// an execute or collect transition never carries them
	assert.throws(() => decodeReviewNextTransitionV3({ kind: "execute", reason_code: "fresh_target_ready", execute: { operation: "review.start", arguments: [{ name: "lineage", value: "review-fixture" }], preconditions: [], binding: { target_identity: digest } }, unachievable_lens_slots: [unachievableSlot()] }), /unachievable_lens_slots is only valid/);
	// plain stops stay unchanged
	assert.equal(decodeReviewNextTransitionV3({ kind: "stop", reason_code: "rdd_disabled" }).unachievableLensSlots, undefined);
});

// gentle-pi#822: the withdraw form names the slot identity twice — as named arguments and as the binding object — and a slot whose two renderings disagree never decodes, so restart cannot withdraw a different slot.
