import assert from "node:assert/strict";
import test from "node:test";
import { deriveJeroStatusActionV1 } from "../../lib/authority/transitions.ts";
import type { JeroLensName, JeroReviewStateName } from "../../lib/authority/protocol.ts";

// The in-process port of the deleted cross-lane battery's "controller
// ordering = authority next step" assertions (design §5.1.7): for every
// persisted state × condition combination, the STATUS-derived next transition
// must be exactly the step the controller can actually take — collect only
// when an input is genuinely missing, execute only when admission is complete,
// stop only on terminals. A controller that "knows better" than the authority
// is the failure mode this table forbids.

type Row = {
	state: JeroReviewStateName;
	mode?: "judgment_day";
	selectedLenses?: JeroLensName[];
	admittedLenses?: JeroLensName[];
	pendingRefuterIds?: string[];
	fixFindingIds?: string[];
	consumed?: boolean;
	expect: { kind: "execute" | "collect" | "stop"; reason_code: string };
};

const ROWS: readonly Row[] = [
	// Ordinary line: the lens admission ladder.
	{ state: "unreviewed", expect: { kind: "execute", reason_code: "captured_results_ready" } },
	{ state: "reviewing", selectedLenses: ["review-risk", "review-resilience"], admittedLenses: [], expect: { kind: "collect", reason_code: "reviewer_results_required" } },
	{ state: "reviewing", selectedLenses: ["review-risk"], admittedLenses: ["review-risk"], expect: { kind: "execute", reason_code: "captured_results_ready" } },
	{ state: "reviewing", selectedLenses: [], admittedLenses: [], expect: { kind: "execute", reason_code: "captured_results_ready" } },
	// Evidence ladder.
	{ state: "findings_frozen", pendingRefuterIds: ["f1"], expect: { kind: "collect", reason_code: "refuter_outcome_required" } },
	{ state: "findings_frozen", pendingRefuterIds: [], expect: { kind: "collect", reason_code: "evidence_classification_required" } },
	{ state: "evidence_classified", fixFindingIds: ["f1"], expect: { kind: "collect", reason_code: "correction_plan_required" } },
	{ state: "evidence_classified", fixFindingIds: [], expect: { kind: "execute", reason_code: "final_verification_ready" } },
	// The open correction phase (fix_required|fixing both project onto the
	// wire correction_required, spec §A.1). NOTE: during `fixing` the offered
	// plan slot is INERT — authorize-fix from fixing is illegal
	// (authorize-fix-requires-fix-required) and the fixing actor is driven by
	// the finalize fix_application path, not a STATUS collect. The P4
	// extension wiring owns presenting the fix dispatch during this window.
	{ state: "fix_required", expect: { kind: "collect", reason_code: "correction_plan_required" } },
	{ state: "fixing", expect: { kind: "collect", reason_code: "correction_plan_required" } },
	{ state: "fix_validating", expect: { kind: "collect", reason_code: "targeted_validation_ready" } },
	{ state: "ready_final_verification", expect: { kind: "collect", reason_code: "final_evidence_required" } },
	{ state: "final_verifying", expect: { kind: "execute", reason_code: "final_outcome_required" } },
	// Terminals: approval awaits acknowledgement, then burns to a fresh START.
	{ state: "approved", expect: { kind: "execute", reason_code: "approved_awaiting_acknowledgement" } },
	{ state: "approved", consumed: true, expect: { kind: "stop", reason_code: "authority_consumed" } },
	{ state: "escalated", expect: { kind: "stop", reason_code: "escalated_terminal" } },
	{ state: "invalidated", expect: { kind: "stop", reason_code: "invalidated_terminal" } },
	// Judgment Day: judge admission rides the ordinary captured-results shape
	// at reviewing (lenses are [] by construction); the frozen ledger waits
	// at judges_confirmed.
	{ state: "reviewing", mode: "judgment_day", selectedLenses: [], admittedLenses: [], expect: { kind: "execute", reason_code: "captured_results_ready" } },
	{ state: "judges_confirmed", mode: "judgment_day", expect: { kind: "execute", reason_code: "judgment_ledger_ready" } },
];

for (const row of ROWS) {
	test(`ordering: ${row.state}${row.mode === "judgment_day" ? " (JD)" : ""}${row.consumed ? " consumed" : ""} → ${row.expect.kind}/${row.expect.reason_code}`, () => {
		const { action, next } = deriveJeroStatusActionV1({
			state: row.state,
			mode: row.mode ?? "ordinary_4r",
			selectedLenses: row.selectedLenses ?? [],
			admittedLenses: row.admittedLenses ?? [],
			pendingRefuterIds: row.pendingRefuterIds,
			fixFindingIds: row.fixFindingIds,
			consumed: row.consumed ?? false,
		});
		assert.deepEqual({ kind: next.kind, reason_code: next.reason_code }, row.expect);
		// The action is part of the same derived row (upstream vocabulary:
		// stop transitions pair with maintainer_action, collect pairs with the
		// offering action); assert only that it is a non-empty member of the
		// closed set the derivation can emit.
		assert.equal(typeof action, "string");
		assert.notEqual(action.length, 0);
	});
}
