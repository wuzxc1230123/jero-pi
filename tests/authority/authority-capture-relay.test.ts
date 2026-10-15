import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { prepareReviewHostRelaySlot, submitReviewHostRelayPreparedResult, type ReviewHostRelayRequest } from "../../lib/review-host-relay.ts";
import { renderJeroCaptureSlotForRelayV1, admitJeroCaptureResultForRelayV1 } from "../../lib/authority/capture-relay.ts";
import { reviewStartV1 } from "../../lib/authority/start.ts";
import { reviewStatusV1 } from "../../lib/authority/status.ts";
import { listJeroResultArtifactsV1, jeroReviewerResultsDirectoryV1 } from "../../lib/authority/result-artifacts.ts";
import { reviewHarness } from "./fixtures.ts";

// P4b end-to-end composition: the production relay path with the REAL
// authority seams — renderJeroCaptureSlotForRelayV1 (in-process prompt bytes
// from the lineage record) and admitJeroCaptureResultForRelayV1 (in-process
// admission over the staged 0o600 result file) — with only the locked pi
// child faked per the expected output contract. This is the wiring
// extensions/jero-ai.ts now runs by default (runJeroAuthorityRelaySlot).

function reviewerEnvelope(lens: string): Buffer {
	return Buffer.from(JSON.stringify({
		review_result: { lens_results: [{ lens, findings: [], evidence: [`scope-reviewed evidence for ${lens}`] }] },
	}));
}

function relayRequestFromCollectInput(collectInput: {
	arguments: readonly { token: string }[];
	submission?: { operation_token: string; argument_tokens: readonly string[]; value: { slot: string; domain: string; substitution_location: number; schema?: string } };
}, cwd: string): ReviewHostRelayRequest {
	const submission = collectInput.submission;
	if (submission === undefined) throw new Error("collect input carries no submission descriptor");
	return {
		captureArgumentTokens: collectInput.arguments.map(({ token }) => token),
		targetCwd: cwd,
		submission: {
			operationToken: submission.operation_token,
			argumentTokens: submission.argument_tokens,
			values: [{ slot: submission.value.slot, domain: submission.value.domain, substitutionLocation: submission.value.substitution_location }],
		},
	};
}

test("P4b: the relay composes renderBinding + in-process admission end to end", async (t) => {
	const harness = reviewHarness(t, "medium", 4);
	const context = harness.context;
	const start = reviewStartV1(context, { cwd: harness.repo }, { consent: "granted" });
	assert.equal(start.kind, "created");
	if (start.kind !== "created") return;

	const status = reviewStatusV1(context, { cwd: harness.repo });
	assert.equal(status.kind, "status");
	if (status.kind !== "status") return;
	const collectInput = status.next_transition.collect?.inputs[0];
	assert.ok(collectInput !== undefined, "reviewing STATUS offers the reviewer collect input");
	assert.equal(collectInput.capture_operation, "review.capture-result");

	const request = relayRequestFromCollectInput(collectInput, harness.repo);
	const rawResult = reviewerEnvelope("review-readability");

	const fakeReviewer = async (promptBytes: Buffer) => {
		// The prompt is the authority-rendered binding — real bytes, no spawn.
		assert.ok(promptBytes.length > 0);
		assert.match(promptBytes.toString("utf8"), /review-readability/);
		return { stdout: rawResult, promptByteLength: promptBytes.length, stdoutByteLength: rawResult.length };
	};

	const prepared = await prepareReviewHostRelaySlot(request, fakeReviewer, renderJeroCaptureSlotForRelayV1);
	assert.equal(prepared.promptByteLength, (await renderJeroCaptureSlotForRelayV1(request)).promptBytes.length);

	const result = await submitReviewHostRelayPreparedResult(prepared, admitJeroCaptureResultForRelayV1);
	assert.equal(result.promptByteLength, prepared.promptByteLength);
	assert.equal(result.resultByteLength, rawResult.length);
	// The submission string is the admitted artifact's canonical JSON.
	// Q-A2: a clean single-lens artifact set closes the review inside the
	// admission (the old binary's atomic capture-result boundary), so the
	// submission is now the approved last-event closure; the artifact trail
	// below still proves the admission itself.
	const admitted = JSON.parse(result.submission) as { schema?: string; state?: string; operation?: string };
	assert.equal(admitted.schema, "jero-ai.review-last-event-closure/v1");
	assert.equal(admitted.state, "approved");
	assert.equal(admitted.operation, "review/capture-result");
	// The artifact trail exists on disk: the verbatim reviewer bytes plus the
	// discovery manifest entry.
	assert.deepEqual(readFileSync(join(jeroReviewerResultsDirectoryV1(context.store.store_root, start.lineage_id), "00-review-readability.json")), rawResult);
	assert.equal(listJeroResultArtifactsV1(context, start.lineage_id).length, 1);
});

test("P4b: a stale binding revision refuses [invalid_request] before any reviewer runs", async (t) => {
	const harness = reviewHarness(t, "medium", 4);
	const context = harness.context;
	const start = reviewStartV1(context, { cwd: harness.repo }, { consent: "granted" });
	if (start.kind !== "created") return;
	const status = reviewStatusV1(context, { cwd: harness.repo });
	if (status.kind !== "status") return;
	const collectInput = status.next_transition.collect?.inputs[0];
	if (collectInput === undefined) throw new Error("no collect input");
	const request = relayRequestFromCollectInput(collectInput, harness.repo);
	const stale = {
		...request,
		captureArgumentTokens: request.captureArgumentTokens.map((token) => token.startsWith("--expected-revision=") ? `--expected-revision=sha256:${"f".repeat(64)}` : token),
	};
	let reviewerRan = false;
	await assert.rejects(
		prepareReviewHostRelaySlot(stale, async (promptBytes: Buffer) => { reviewerRan = true; return { stdout: Buffer.from(""), promptByteLength: promptBytes.length, stdoutByteLength: 0 }; }, renderJeroCaptureSlotForRelayV1),
		/invalid_request.*drifted/,
	);
	assert.equal(reviewerRan, false, "a drifted binding never reaches a reviewer process");
});

// 真机冒烟回归：评审者是自由生成的模型，且权威提示词的输出契约样例
// 本身以 ```json 围栏展示——真实中继的评审输出会带回围栏或散文前言
// （冒烟实测两类形态都发生），曾经的逐字节严格 JSON.parse 在信封解码
// 之前就把它们拒成 submission-refused。受理面现在做确定性的运输容器
// 提取，信封严格解码原样保留：围栏体、散文前言+围栏、散文+裸 JSON
// 三种容器形态都必须受理，且暂存字节是提取出的 JSON 本体（组合面的
// 严格重解析保持自洽）；纯散文（提不出任何 JSON）仍照常拒收。
test("P4b: fenced or prose-wrapped reviewer envelopes admit via deterministic extraction", async (t) => {
	const envelope = reviewerEnvelope("review-readability");
	const envelopeText = envelope.toString("utf8");
	const shapes: readonly { readonly label: string; readonly stdout: Buffer }[] = [
		{ label: "```json 围栏体", stdout: Buffer.from(`\`\`\`json\n${envelopeText}\n\`\`\``, "utf8") },
		{ label: "散文前言 + 围栏", stdout: Buffer.from(`I'll review this candidate now.\n\n\`\`\`json\n${envelopeText}\n\`\`\`\n`, "utf8") },
		{ label: "散文 + 裸 JSON", stdout: Buffer.from(`Here is my envelope: ${envelopeText}`, "utf8") },
	];
	for (const shape of shapes) {
		const harness = reviewHarness(t, "medium", 4);
		const context = harness.context;
		const start = reviewStartV1(context, { cwd: harness.repo }, { consent: "granted" });
		assert.equal(start.kind, "created", shape.label);
		if (start.kind !== "created") continue;
		const status = reviewStatusV1(context, { cwd: harness.repo });
		assert.equal(status.kind, "status", shape.label);
		if (status.kind !== "status") continue;
		const collectInput = status.next_transition.collect?.inputs[0];
		if (collectInput === undefined) throw new Error("no collect input");
		const request = relayRequestFromCollectInput(collectInput, harness.repo);
		const prepared = await prepareReviewHostRelaySlot(request, async (promptBytes: Buffer) => ({ stdout: shape.stdout, promptByteLength: promptBytes.length, stdoutByteLength: shape.stdout.length }), renderJeroCaptureSlotForRelayV1);
		const result = await submitReviewHostRelayPreparedResult(prepared, admitJeroCaptureResultForRelayV1);
		// 干净单透镜产物集在受理内闭环节点：提交串即 approved 闭包。
		const closure = JSON.parse(result.submission) as { state?: string };
		assert.equal(closure.state, "approved", shape.label);
		// 暂存的是提取出的 JSON 本体，不是运输容器。
		assert.deepEqual(readFileSync(join(jeroReviewerResultsDirectoryV1(context.store.store_root, start.lineage_id), "00-review-readability.json")), envelope, shape.label);
	}
});

// 边角回归：信封的 JSON 字符串值本身含 ``` 时，非贪婪围栏提取会在串内
// 提前截断——围栏候选不可解析必须回落花括号跨距取完整对象，而不是把
// 截断体交出去吃一个可避免的拒收。
test("P4b: a fenced envelope whose string values contain ``` falls back to brace extraction", async (t) => {
	const harness = reviewHarness(t, "medium", 4);
	const context = harness.context;
	const tricky = Buffer.from(JSON.stringify({
		review_result: { lens_results: [{ lens: "review-readability", findings: [], evidence: ["fence marker ``` inside a string value"] }] },
	}), "utf8");
	const start = reviewStartV1(context, { cwd: harness.repo }, { consent: "granted" });
	if (start.kind !== "created") return;
	const status = reviewStatusV1(context, { cwd: harness.repo });
	if (status.kind !== "status") return;
	const collectInput = status.next_transition.collect?.inputs[0];
	if (collectInput === undefined) throw new Error("no collect input");
	const request = relayRequestFromCollectInput(collectInput, harness.repo);
	const fencedTricky = Buffer.from(`\`\`\`json\n${tricky.toString("utf8")}\n\`\`\``, "utf8");
	const result = await submitReviewHostRelayPreparedResult(
		await prepareReviewHostRelaySlot(request, async (promptBytes: Buffer) => ({ stdout: fencedTricky, promptByteLength: promptBytes.length, stdoutByteLength: fencedTricky.length }), renderJeroCaptureSlotForRelayV1),
		admitJeroCaptureResultForRelayV1,
	);
	const closure = JSON.parse(result.submission) as { state?: string };
	assert.equal(closure.state, "approved");
	assert.deepEqual(readFileSync(join(jeroReviewerResultsDirectoryV1(context.store.store_root, start.lineage_id), "00-review-readability.json")), tricky);
});

test("P4b: pure-prose reviewer output still refuses — no JSON to extract", async (t) => {
	const harness = reviewHarness(t, "medium", 4);
	const start = reviewStartV1(harness.context, { cwd: harness.repo }, { consent: "granted" });
	if (start.kind !== "created") return;
	const status = reviewStatusV1(harness.context, { cwd: harness.repo });
	if (status.kind !== "status") return;
	const collectInput = status.next_transition.collect?.inputs[0];
	if (collectInput === undefined) throw new Error("no collect input");
	const request = relayRequestFromCollectInput(collectInput, harness.repo);
	const prose = Buffer.from("I looked at the diff and it all seems fine to me. Nothing to report.", "utf8");
	await assert.rejects(
		submitReviewHostRelayPreparedResult(
			await prepareReviewHostRelaySlot(request, async (promptBytes: Buffer) => ({ stdout: prose, promptByteLength: promptBytes.length, stdoutByteLength: prose.length }), renderJeroCaptureSlotForRelayV1),
			admitJeroCaptureResultForRelayV1,
		),
		/capture admission failed.*not valid JSON/,
	);
});

// 真机复跑回归：评审者散文前言先出现与信封无关的花括号（{the candidate}
// 类）时，旧提取器取首个平衡跨距即交出垃圾、吃 "Expected property name"
// 拒收——多跨距试解析必须跳过垃圾跨距、取到真正可解析的信封本体。
test("P4b: prose braces before the envelope are skipped by multi-span extraction", async (t) => {
	const harness = reviewHarness(t, "medium", 4);
	const context = harness.context;
	const envelope = reviewerEnvelope("review-readability");
	const wrapped = Buffer.from(`I checked {the candidate} and found it clean.\n\nHere is my envelope: ${envelope.toString("utf8")}`, "utf8");
	const start = reviewStartV1(context, { cwd: harness.repo }, { consent: "granted" });
	if (start.kind !== "created") return;
	const status = reviewStatusV1(context, { cwd: harness.repo });
	if (status.kind !== "status") return;
	const collectInput = status.next_transition.collect?.inputs[0];
	if (collectInput === undefined) throw new Error("no collect input");
	const request = relayRequestFromCollectInput(collectInput, harness.repo);
	const result = await submitReviewHostRelayPreparedResult(
		await prepareReviewHostRelaySlot(request, async (promptBytes: Buffer) => ({ stdout: wrapped, promptByteLength: promptBytes.length, stdoutByteLength: wrapped.length }), renderJeroCaptureSlotForRelayV1),
		admitJeroCaptureResultForRelayV1,
	);
	const closure = JSON.parse(result.submission) as { state?: string };
	assert.equal(closure.state, "approved");
	assert.deepEqual(readFileSync(join(jeroReviewerResultsDirectoryV1(context.store.store_root, start.lineage_id), "00-review-readability.json")), envelope);
});

// 残余弱面回归：散文前言先出现"可解析但不是信封"的 JSON（{} 或
// {"note":…}）时，只按 JSON.parse 过滤的跨距会把它当候选交出、在下游
// 信封解码吃一个可避免的拒收——试解析的判据必须包含信封严格解码，
// 跳过可解析的异物、取到真正的信封本体。
test("P4b: parseable-but-not-envelope JSON in prose is skipped by multi-span extraction", async (t) => {
	const harness = reviewHarness(t, "medium", 4);
	const context = harness.context;
	const envelope = reviewerEnvelope("review-readability");
	const wrapped = Buffer.from(`Placeholder {} and notes {"note":"irrelevant"} above.\n\nEnvelope: ${envelope.toString("utf8")}`, "utf8");
	const start = reviewStartV1(context, { cwd: harness.repo }, { consent: "granted" });
	assert.equal(start.kind, "created");
	if (start.kind !== "created") return;
	const status = reviewStatusV1(context, { cwd: harness.repo });
	assert.equal(status.kind, "status");
	if (status.kind !== "status") return;
	const collectInput = status.next_transition.collect?.inputs[0];
	if (collectInput === undefined) throw new Error("no collect input");
	const request = relayRequestFromCollectInput(collectInput, harness.repo);
	const result = await submitReviewHostRelayPreparedResult(
		await prepareReviewHostRelaySlot(request, async (promptBytes: Buffer) => ({ stdout: wrapped, promptByteLength: promptBytes.length, stdoutByteLength: wrapped.length }), renderJeroCaptureSlotForRelayV1),
		admitJeroCaptureResultForRelayV1,
	);
	const closure = JSON.parse(result.submission) as { state?: string };
	assert.equal(closure.state, "approved");
	assert.deepEqual(readFileSync(join(jeroReviewerResultsDirectoryV1(context.store.store_root, start.lineage_id), "00-review-readability.json")), envelope);
});

// 病态输入回归：全 '{' 无配对的散文让多跨距扫描最坏退化为 O(n²)——
// 字符预算耗尽后必须按原始字节交回（原生解析错误照常拒收），不给
// 权威进程无限同步阻塞的敞口。10 万个 '{' 无预算时约 5×10⁹ 次字符
// 比较（分钟级），预算内毫秒级放弃。
test("P4b: pathological unbalanced-brace prose bails within the scan budget and still refuses", async (t) => {
	const harness = reviewHarness(t, "medium", 4);
	const start = reviewStartV1(harness.context, { cwd: harness.repo }, { consent: "granted" });
	if (start.kind !== "created") return;
	const status = reviewStatusV1(harness.context, { cwd: harness.repo });
	if (status.kind !== "status") return;
	const collectInput = status.next_transition.collect?.inputs[0];
	if (collectInput === undefined) throw new Error("no collect input");
	const request = relayRequestFromCollectInput(collectInput, harness.repo);
	const pathological = Buffer.from(`conclusion follows and never closes: ${"{".repeat(100_000)}`, "utf8");
	await assert.rejects(
		submitReviewHostRelayPreparedResult(
			await prepareReviewHostRelaySlot(request, async (promptBytes: Buffer) => ({ stdout: pathological, promptByteLength: promptBytes.length, stdoutByteLength: pathological.length }), renderJeroCaptureSlotForRelayV1),
			admitJeroCaptureResultForRelayV1,
		),
		/capture admission failed.*not valid JSON/,
	);
});

test("parseValidatorFixCausedFindingsV1：发现行严格解码，畸形答案拒绝而非静默置空", async () => {
	const { parseValidatorFixCausedFindingsV1 } = await import("../../lib/authority/capture-relay.ts");
	// 缺省按空集受理（渲染契约恒含该键，缺失视为空答案）。
	assert.deepEqual(parseValidatorFixCausedFindingsV1(undefined), { kind: "ok", rows: [] });
	assert.deepEqual(parseValidatorFixCausedFindingsV1([]), { kind: "ok", rows: [] });
	// 合法发现行逐字段往返（severity 封闭词汇、proof_refs 字符串数组）。
	const decoded = parseValidatorFixCausedFindingsV1([
		{ id: "FIXED-1", location: "src/a.ts:10", severity: "WARNING", claim: "修正引入的回归", proof_refs: ["cmd output"] },
		{ claim: "最小行" },
	]);
	assert.equal(decoded.kind, "ok");
	if (decoded.kind === "ok") {
		assert.deepEqual(decoded.rows, [
			{ id: "FIXED-1", location: "src/a.ts:10", severity: "WARNING", claim: "修正引入的回归", proof_refs: ["cmd output"] },
			{ claim: "最小行" },
		]);
	}
	// 畸形形态全部类型化拒绝：非数组/非对象行/未知键/词汇外 severity/非字符串字段。
	for (const bad of [
		"nope",
		[null],
		[{ summary: "x" }],
		[{ severity: "MAJOR" }],
		[{ claim: 42 }],
		[{ proof_refs: [1] }],
	] as unknown[]) {
		assert.equal(parseValidatorFixCausedFindingsV1(bad).kind, "invalid", `必须拒绝：${JSON.stringify(bad)}`);
	}
});
