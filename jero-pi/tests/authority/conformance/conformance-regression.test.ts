import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { decodeReviewConsentV3, decodeReviewCapabilitiesV2 } from "../../../lib/review-integration-v2.ts";

// §J.1 assertions 11-12: consent/v3 invocation vectors (a regression anchor —
// unchanged by M3) and the capabilities/v2.2 vocabulary anchor. Fixture decode
// only; no upstream hash bytes are asserted (the executable digest is taken
// from the fixture itself, self-reported evidence).

const fixturesRoot = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "fixtures", "devbinary");

function fixture(name: string): Record<string, unknown> {
	return JSON.parse(readFileSync(join(fixturesRoot, `${name}.captured.json`), "utf8")) as Record<string, unknown>;
}

// 11. consent-v3
test("conformance 11: consent/v3 invocation vectors are unchanged by M3", () => {
	const consent = decodeReviewConsentV3(fixture("consent-v3"));
	assert.equal(consent.action, "consent_required");
	assert.equal(consent.agent, "claude-code");
	assert.equal(consent.blocking, true);
	assert.equal(consent.projection, "workspace");
	assert.equal(consent.riskLevel, "high");
	// Two choices, granted and declined, each carrying an exact invocation
	// bound to the SAME frozen target identity and cwd.
	const answers = consent.choices.map(({ answer }) => answer).toSorted();
	assert.deepEqual(answers, ["declined", "granted"]);
	for (const choice of consent.choices) {
		assert.ok(choice.invocation.startsWith("gentle-ai review start "));
		assert.ok(choice.invocation.includes(`--target ${consent.targetIdentity}`));
		assert.ok(choice.invocation.includes("--projection workspace"));
		assert.ok(choice.invocation.endsWith(`--consent ${choice.answer}`));
	}
	// The off-path command is the mode switch, not a kill switch.
	assert.ok(consent.offPath.command.includes("review mode"));
});

// 12. capabilities-v2.2
test("conformance 12: capabilities/v2.2 anchors the provider vocabulary incl. the targeted-validation and repository-context features", () => {
	const raw = fixture("capabilities-v2.2");
	const digest = (raw.executable as Record<string, unknown>).sha256 as string;
	const capabilities = decodeReviewCapabilitiesV2(raw, digest);
	// The three vocabulary anchors the M3 capture layer names.
	const names = [...capabilities.mandatoryFeatures, ...capabilities.optionalFeatures];
	assert.ok(names.includes("provider_targeted_validation_request"), "provider_targeted_validation_request");
	assert.ok(names.includes("outcome_bound_verification_evidence"), "outcome_bound_verification_evidence");
	assert.ok(names.includes("opaque_repository_context"), "opaque_repository_context");
	// The operation vocabulary includes the capture-era surface (the decoder
	// projects the fixture's list through its own known-operation filter, so
	// the raw list is the vocabulary anchor here).
	for (const operation of ["review.start", "review.status", "review.finalize", "review.validate"]) {
		assert.ok((raw.operations as string[]).includes(operation), operation);
	}
	// Projections: staged + workspace — the §G vocabulary.
	assert.deepEqual([...capabilities.projections].toSorted(), ["staged", "workspace"]);
});
