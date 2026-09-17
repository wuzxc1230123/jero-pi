import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { createJeroAuthorityReviewCli } from "../../lib/jero-authority-cli.ts";
import { NativeReviewConsentRequiredError, type NativeStartResult } from "../../lib/native-review-cli.ts";
import { decodeReviewConsentV3 } from "../../lib/authority/wire-contract.ts";
import { repository } from "./fixtures.ts";

// P4d-e: the START pair over the in-process authority. The contracts that
// matter are the ones the extension consumes: consent envelopes decode
// through decodeReviewConsentV3 (the pending registry digests error.consent,
// the UI renders it, answerConsent re-parses its invocation), declined
// answers carry the envelope identity, granted answers start the frozen
// candidate, and drift fails closed with identity-mismatch.

function write(repo: string, relative: string, content: string): void {
	const target = join(repo, relative);
	mkdirSync(dirname(target), { recursive: true });
	writeFileSync(target, content);
}

function harness(t: { after(fn: () => void): void }): { repo: string; cli: ReturnType<typeof createJeroAuthorityReviewCli> } {
	const repo = repository(t, "jero-start-cli-");
	return { repo, cli: createJeroAuthorityReviewCli() };
}

async function consentFor(cli: ReturnType<typeof createJeroAuthorityReviewCli>, repo: string): Promise<NativeReviewConsentRequiredError> {
	try {
		await cli.start({ cwd: repo });
		assert.fail("a medium-risk start under mode-on must ask consent");
	} catch (error) {
		if (!(error instanceof NativeReviewConsentRequiredError)) throw error;
		return error;
	}
}

test("a documentation-only start closes at once with zero lenses", async (t) => {
	const { repo, cli } = harness(t);
	write(repo, "README.md", "test\nmore docs\n");
	const result: NativeStartResult = await cli.start({ cwd: repo });
	assert.equal(result.action, "closed");
	assert.equal(result.state, "approved");
	assert.equal(result.lensesRequired, false);
	assert.deepEqual(result.selectedLenses, []);
	assert.equal(result.hint, undefined);
	assert.ok(result.changedLines > 0);
});

test("a medium-risk start mints a decodable consent/v3 envelope and honours decline", async (t) => {
	const { repo, cli } = harness(t);
	write(repo, "src/util.ts", "export const x = 1;\n");
	const error = await consentFor(cli, repo);
	const envelope = decodeReviewConsentV3(error.consent.raw, "pi");
	assert.equal(envelope.targetIdentity, error.consent.targetIdentity);
	assert.ok(/^sha256:[0-9a-f]{64}$/.test(envelope.targetIdentity));
	assert.equal(envelope.riskLevel, "medium");
	assert.equal(envelope.projection, "workspace");
	assert.match(envelope.reason, /deeper review/);
	assert.ok(envelope.choices[0].invocation.includes(" --agent pi "));
	assert.ok(envelope.choices.every((choice) => choice.invocation.endsWith(` --consent ${choice.answer}`)));
	const declined = await cli.answerConsent({ cwd: repo, consent: error.consent, answer: "declined" });
	assert.equal(declined.kind, "declined");
	if (declined.kind === "declined") {
		assert.equal(declined.consent, "declined_this_candidate");
		assert.equal(declined.targetIdentity, envelope.targetIdentity);
	}
	// The decline created no authority: the same candidate asks again.
	const second = await consentFor(cli, repo);
	assert.equal(second.consent.targetIdentity, envelope.targetIdentity);
});

test("a granted answer starts the frozen candidate and replays idempotently", async (t) => {
	const { repo, cli } = harness(t);
	write(repo, "src/util.ts", "export const y = 2;\n");
	const error = await consentFor(cli, repo);
	const answered = await cli.answerConsent({ cwd: repo, consent: error.consent, answer: "granted" });
	assert.equal(answered.kind, "started");
	if (answered.kind === "started") {
		assert.equal(answered.start.action, "created");
		assert.equal(answered.start.state, "reviewing");
		assert.equal(answered.start.lensesRequired, true);
		assert.equal(answered.start.selectedLenses.length, 1);
	}
	const replay = await cli.answerConsent({ cwd: repo, consent: error.consent, answer: "granted" });
	assert.equal(replay.kind, "started");
	if (replay.kind === "started") assert.equal(replay.start.action, "replayed");
});

test("a high-risk candidate binds four lenses through the consent gate", async (t) => {
	const { repo, cli } = harness(t);
	write(repo, "src/auth.ts", "export function check(): boolean { return true; }\n");
	const error = await consentFor(cli, repo);
	assert.equal(error.consent.riskLevel, "high");
	const answered = await cli.answerConsent({ cwd: repo, consent: error.consent, answer: "granted" });
	if (answered.kind === "started") assert.equal(answered.start.selectedLenses.length, 4);
	else assert.fail("high-risk grant must start");
});

test("an answer for a drifted candidate fails closed on identity", async (t) => {
	const { repo, cli } = harness(t);
	write(repo, "src/util.ts", "export const a = 1;\n");
	const error = await consentFor(cli, repo);
	write(repo, "src/util.ts", "export const a = 2;\nexport const b = 3;\n");
	await assert.rejects(cli.answerConsent({ cwd: repo, consent: error.consent, answer: "granted" }), /identity-mismatch/);
});

test("an untracked inventory drift reports blocked-scope-action with the fresh digest", async (t) => {
	const { repo, cli } = harness(t);
	write(repo, "notes.txt", "scratch\n");
	const result = await cli.start({
		cwd: repo,
		untrackedScope: "select",
		expectedUntrackedInventory: `sha256:${"0".repeat(64)}`,
		intendedUntracked: ["notes.txt"],
	});
	assert.equal(result.action, "blocked-scope-action");
	assert.equal(result.lensesRequired, false);
	assert.match(result.hint ?? "", /fresh intended-untracked inventory: sha256:[0-9a-f]{64}/);
});

test("request discipline TypeErrors fire before the authority is touched", async (t) => {
	const { repo, cli } = harness(t);
	await assert.rejects(cli.start({ cwd: repo, baseRef: "HEAD" } as never), TypeError);
	await assert.rejects(cli.start({ cwd: repo, committedOnly: true } as never), TypeError);
	await assert.rejects(cli.start({ cwd: repo, targetIdentity: "deadbeef" } as never), TypeError);
	await assert.rejects(cli.start({ cwd: repo, untrackedScope: "exclude", expectedUntrackedInventory: "sha256:x", intendedUntracked: ["a.txt"] } as never), TypeError);
});
