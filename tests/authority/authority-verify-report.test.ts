import assert from "node:assert/strict";
import test from "node:test";
import { extractJeroVerifyReportV1, validateJeroVerifyEvidenceForSettleV1 } from "../../lib/authority/verify-report.ts";

const EVIDENCE = `sha256:${"a".repeat(64)}`;

function envelope(overrides: Record<string, unknown> = {}): string {
	const body = {
		schema: "jero.verify-result/v1",
		evidence_revision: EVIDENCE,
		verdict: "pass",
		blockers: 0,
		critical_findings: 0,
		requirements: "4/4",
		scenarios: "2/2",
		test_command: "pnpm test",
		test_exit_code: 0,
		test_output_hash: EVIDENCE,
		build_command: "pnpm build",
		build_exit_code: 0,
		build_output_hash: EVIDENCE,
		...overrides,
	};
	return `# Verify report\n\nProse describing the verification run.\n\n\`\`\`json\n${JSON.stringify(body, null, 2)}\n\`\`\`\n`;
}

test("a well-formed verify-report extracts to the strict envelope", () => {
	const result = extractJeroVerifyReportV1(envelope());
	assert.equal(result.kind, "ok");
	if (result.kind !== "ok") return;
	assert.equal(result.envelope.schema, "jero.verify-result/v1");
	assert.equal(result.envelope.evidence_revision, EVIDENCE);
	assert.equal(result.envelope.requirements, "4/4");
});

test("extraction refusals: no block, multiple blocks, malformed json, schema violations", () => {
	const cases: Array<[string, string, string]> = [
		["no fenced block", "malformed-envelope", "# Report\n\nNo envelope here.\n"],
		["multiple blocks", "malformed-envelope", `${envelope()}\n${envelope()}`],
		["malformed json", "malformed-envelope", "```json\n{ not json\n```\n"],
		["unknown key", "schema-mismatch", envelope({ extra: 1 })],
		["bad ratio", "schema-mismatch", envelope({ requirements: "4" })],
		["bad hash identity", "schema-mismatch", envelope({ test_output_hash: "nope" })],
		["bad verdict", "schema-mismatch", envelope({ verdict: "maybe" })],
	];
	for (const [label, code, text] of cases) {
		const refused = extractJeroVerifyReportV1(text);
		assert.equal(refused.kind, "refused", label);
		if (refused.kind === "refused") assert.equal(refused.code, code, label);
	}
});

test("the settle-side evidence gate binds the envelope to the presented evidence revision", () => {
	const matched = validateJeroVerifyEvidenceForSettleV1({ envelopeText: envelope(), evidenceRevision: EVIDENCE });
	assert.equal(matched.kind, "ok");
	const mismatch = validateJeroVerifyEvidenceForSettleV1({ envelopeText: envelope(), evidenceRevision: `sha256:${"b".repeat(64)}` });
	assert.equal(mismatch.kind, "refused");
	if (mismatch.kind === "refused") assert.match(mismatch.detail, /evidence_revision/);
});
