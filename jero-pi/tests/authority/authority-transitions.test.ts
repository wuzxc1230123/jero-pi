import assert from "node:assert/strict";
import test from "node:test";
import {
	JERO_TERMINAL_MUTATION_EVENTS,
	checkJeroReviewTransitionV1,
	deriveJeroStatusActionV1,
	isJeroOrdinaryModeV1,
	projectJeroReviewStateV1,
} from "../../lib/authority/transitions.ts";
import type { JeroLensName, JeroReviewMode, JeroReviewStateName } from "../../lib/authority/protocol.ts";

// Spec §A: the persisted→wire projection (§A.1) and the definitive
// transition table (§A.2) — every legal transition asserts its target state,
// every illegal transition fails closed. Pure: no repository, no IO.

const PERSISTED_STATES: readonly JeroReviewStateName[] = [
	"unreviewed", "reviewing", "judges_confirmed", "findings_frozen", "evidence_classified",
	"fix_required", "fixing", "fix_validating", "ready_final_verification", "final_verifying",
	"approved", "escalated", "invalidated",
];

test("the persisted 13-state record projects onto the wire 15-state vocabulary (§A.1)", () => {
	const identity: readonly [JeroReviewStateName, JeroReviewStateName][] = [
		["unreviewed", "unreviewed"], ["reviewing", "reviewing"], ["judges_confirmed", "judges_confirmed"],
		["findings_frozen", "findings_frozen"], ["evidence_classified", "evidence_classified"],
		["approved", "approved"], ["escalated", "escalated"], ["invalidated", "invalidated"],
	];
	for (const [persisted, wire] of identity) assert.equal(projectJeroReviewStateV1(persisted), wire);
	// The open correction phase projects onto the wire `correction_required`.
	assert.equal(projectJeroReviewStateV1("fix_required"), "correction_required");
	assert.equal(projectJeroReviewStateV1("fixing"), "correction_required");
	// The validating tail projects onto the wire `validating` aggregate.
	assert.equal(projectJeroReviewStateV1("fix_validating"), "validating");
	assert.equal(projectJeroReviewStateV1("ready_final_verification"), "validating");
	assert.equal(projectJeroReviewStateV1("final_verifying"), "validating");
});

test("the projection aggregates exactly: 13 persisted states collapse to 10 wire states", () => {
	const wire = new Set(PERSISTED_STATES.map(projectJeroReviewStateV1));
	assert.equal(wire.size, 10);
	// The two aggregates: 2 correction states → correction_required, 3 validating states → validating.
	assert.equal(PERSISTED_STATES.filter((state) => projectJeroReviewStateV1(state) === "correction_required").length, 2);
	assert.equal(PERSISTED_STATES.filter((state) => projectJeroReviewStateV1(state) === "validating").length, 3);
});

test("ordinary line: every legal transition asserts its writes (§A.2 ordinary table)", () => {
	const ordinary: JeroReviewMode = "ordinary_4r";
	const guards = { fixRounds: 0, fixBatches: 0 };
	assert.deepEqual(checkJeroReviewTransitionV1("reviewing", ordinary, "freeze-ledger", guards), { legal: true, from: "reviewing", event: "freeze-ledger", next: "findings_frozen" });
	assert.equal(checkJeroReviewTransitionV1("findings_frozen", ordinary, "resolve-evidence", guards).next, "evidence_classified");
	assert.equal(checkJeroReviewTransitionV1("fix_required", ordinary, "authorize-fix", guards).next, "fixing");
	assert.equal(checkJeroReviewTransitionV1("fixing", ordinary, "apply-fix", guards).next, "fix_validating");
	assert.equal(checkJeroReviewTransitionV1("fix_validating", ordinary, "validate-fix", guards).next, "ready_final_verification");
	assert.equal(checkJeroReviewTransitionV1("ready_final_verification", ordinary, "record-final-evidence", guards).next, "final_verifying");
	assert.equal(checkJeroReviewTransitionV1("final_verifying", ordinary, "finalize-outcome", guards).next, "final_verifying");
	assert.equal(checkJeroReviewTransitionV1("approved", ordinary, "acknowledge", guards).next, "approved");
	// Row 7c: verification_failed reopens the correction, not a new transaction.
	assert.equal(checkJeroReviewTransitionV1("fix_validating", ordinary, "reopen-fix", guards).next, "fixing");
});

test("judgment day line: judges confirm, judgment freeze, and re-fix (§A.2 JD table)", () => {
	const judgmentDay: JeroReviewMode = "judgment_day";
	const guards = { fixRounds: 0, fixBatches: 0 };
	assert.equal(checkJeroReviewTransitionV1("reviewing", judgmentDay, "confirm-judges", guards).next, "judges_confirmed");
	assert.equal(checkJeroReviewTransitionV1("judges_confirmed", judgmentDay, "freeze-judgment-ledger", guards).next, "findings_frozen");
	// NIT (review): authorize-fix requires fix_required in EVERY mode — the
	// vestigial judges_confirmed disjunct is gone (a JD lineage exits
	// judges_confirmed only via freeze-judgment-ledger).
	assert.equal(checkJeroReviewTransitionV1("judges_confirmed", judgmentDay, "authorize-fix", guards).legal, false);
	// JD allows a second fix batch (fix_batches budget 2).
	assert.equal(checkJeroReviewTransitionV1("fix_required", judgmentDay, "authorize-fix", { fixRounds: 0, fixBatches: 1 }).legal, true);
	assert.equal(checkJeroReviewTransitionV1("fix_required", judgmentDay, "authorize-fix", { fixRounds: 0, fixBatches: 2 }).legal, false);
});

test("ILLEGAL 1: any mutation from approved/escalated/invalidated fails closed", () => {
	for (const terminal of ["approved", "escalated", "invalidated"] as const) {
		for (const event of JERO_TERMINAL_MUTATION_EVENTS) {
			const check = checkJeroReviewTransitionV1(terminal, "ordinary_4r", event, { fixRounds: 0, fixBatches: 0 });
			assert.equal(check.legal, false, `${terminal} × ${event} must be illegal`);
			assert.match(check.reason ?? "", /terminal-state/);
		}
	}
});

test("ILLEGAL 2: lens admission from any state other than reviewing fails closed", () => {
	for (const state of PERSISTED_STATES.filter((candidate) => candidate !== "reviewing")) {
		const check = checkJeroReviewTransitionV1(state, "ordinary_4r", "freeze-ledger", { fixRounds: 0, fixBatches: 0 });
		assert.equal(check.legal, false, `freeze-ledger from ${state} must be illegal`);
	}
});

test("ILLEGAL 3: resolve-evidence before freeze-ledger fails closed", () => {
	const check = checkJeroReviewTransitionV1("reviewing", "ordinary_4r", "resolve-evidence", { fixRounds: 0, fixBatches: 0 });
	assert.equal(check.legal, false);
	assert.match(check.reason ?? "", /requires-frozen-ledger/);
});

test("ILLEGAL 4: a second correction transaction fails closed while preserving counters", () => {
	const check = checkJeroReviewTransitionV1("fix_required", "ordinary_4r", "authorize-fix", { fixRounds: 1, fixBatches: 1 });
	assert.equal(check.legal, false);
	assert.match(check.reason ?? "", /second-correction/);
});

test("ILLEGAL 9: cross-mode operations fail closed in both directions", () => {
	// JD events on an ordinary lineage.
	assert.equal(checkJeroReviewTransitionV1("reviewing", "ordinary_4r", "confirm-judges", { fixRounds: 0, fixBatches: 0 }).legal, false);
	assert.equal(checkJeroReviewTransitionV1("judges_confirmed", "ordinary_4r", "freeze-judgment-ledger", { fixRounds: 0, fixBatches: 0 }).legal, false);
	// Ordinary lens admission on a JD lineage.
	assert.equal(checkJeroReviewTransitionV1("reviewing", "judgment_day", "freeze-ledger", { fixRounds: 0, fixBatches: 0 }).legal, false);
});

test("ILLEGAL 8: acknowledge on any non-approved state fails closed", () => {
	for (const state of PERSISTED_STATES.filter((candidate) => candidate !== "approved")) {
		assert.equal(checkJeroReviewTransitionV1(state, "ordinary_4r", "acknowledge", { fixRounds: 0, fixBatches: 0 }).legal, false, `acknowledge from ${state} must be illegal`);
	}
});

test("escalation is legal from every active state and stays terminal once escalated", () => {
	for (const state of PERSISTED_STATES.filter((candidate) => candidate !== "approved" && candidate !== "escalated" && candidate !== "invalidated")) {
		const check = checkJeroReviewTransitionV1(state, "ordinary_4r", "escalate", { fixRounds: 0, fixBatches: 0 });
		assert.equal(check.legal, true, `escalate from ${state} must be legal`);
		assert.equal(check.next, "escalated");
	}
	assert.equal(checkJeroReviewTransitionV1("approved", "ordinary_4r", "escalate", { fixRounds: 0, fixBatches: 0 }).legal, false);
	assert.equal(checkJeroReviewTransitionV1("escalated", "ordinary_4r", "escalate", { fixRounds: 0, fixBatches: 0 }).legal, true);
});

test("validate-fix before the bounded edit, and final evidence before ready, fail closed", () => {
	assert.equal(checkJeroReviewTransitionV1("fixing", "ordinary_4r", "validate-fix", { fixRounds: 0, fixBatches: 0 }).legal, false);
	assert.equal(checkJeroReviewTransitionV1("fix_validating", "ordinary_4r", "record-final-evidence", { fixRounds: 0, fixBatches: 0 }).legal, false);
	assert.equal(checkJeroReviewTransitionV1("ready_final_verification", "ordinary_4r", "finalize-outcome", { fixRounds: 0, fixBatches: 0 }).legal, false);
});

test("status action derivation uses the schema-union vocabulary (§C.3, discrepancy #2)", () => {
	const lensNames = (names: string[]) => names as JeroLensName[];
	const reviewing = (selected: string[], admitted: string[]) => deriveJeroStatusActionV1({
		state: "reviewing", mode: "ordinary_4r", selectedLenses: lensNames(selected), admittedLenses: lensNames(admitted), pendingRefuterIds: [], fixFindingIds: [], consumed: false,
	});
	assert.equal(reviewing(["review-risk"], []).action, "start");
	assert.equal(reviewing(["review-risk"], ["review-risk"]).action, "finalize");
	assert.equal(reviewing(["review-risk"], ["review-risk"]).next.operation, "review.finalize");
	const escalation = deriveJeroStatusActionV1({
		state: "escalated", mode: "ordinary_4r", selectedLenses: [], admittedLenses: [], pendingRefuterIds: [], fixFindingIds: [], consumed: false,
	});
	assert.equal(escalation.action, "maintainer_action");
	const approved = deriveJeroStatusActionV1({
		state: "approved", mode: "ordinary_4r", selectedLenses: [], admittedLenses: [], pendingRefuterIds: [], fixFindingIds: [], consumed: false,
	});
	assert.equal(approved.action, "stop");
	assert.equal(approved.next.operation, "review.acknowledge-approved");
	const consumed = deriveJeroStatusActionV1({
		state: "approved", mode: "ordinary_4r", selectedLenses: [], admittedLenses: [], pendingRefuterIds: [], fixFindingIds: [], consumed: true,
	});
	assert.equal(consumed.next.reason_code, "authority_consumed");
});

test("the ordinary mode family excludes judgment day", () => {
	assert.equal(isJeroOrdinaryModeV1("ordinary_4r"), true);
	assert.equal(isJeroOrdinaryModeV1("ordinary_bounded"), true);
	assert.equal(isJeroOrdinaryModeV1("judgment_day"), false);
});

test("Mi5 (§A.4): fix_validating derives a COLLECT targeted-validation vector, never a direct execute", () => {
	const derived = deriveJeroStatusActionV1({
		state: "fix_validating", mode: "ordinary_4r", selectedLenses: [], admittedLenses: [], pendingRefuterIds: [], fixFindingIds: [], consumed: false,
	});
	assert.equal(derived.action, "validate");
	assert.equal(derived.next.kind, "collect");
	assert.equal(derived.next.reason_code, "targeted_validation_ready");
	assert.equal(derived.next.operation, "review.validate");
});
