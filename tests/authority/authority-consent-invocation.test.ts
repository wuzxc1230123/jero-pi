// 同意封套调用词的渲染↔解析往返：projectJeroConsentEnvelopeV1 产出的
// invocation 必须经 consentInvocationArguments 无损绑定回来——值含空白
// （Windows 用户目录、含空格的未跟踪路径）时渲染端要加引号，否则分词
// 截断使应答恒失败于 consent-invocation-cwd-changed（fail-closed 的功能
// 缺陷，非放行）。

import assert from "node:assert/strict";
import test from "node:test";

import { consentInvocationArguments } from "../../lib/authority/client-contract.ts";
import { projectJeroConsentEnvelopeV1 } from "../../lib/authority/wire.ts";
import type { JeroReviewStartResultV1 } from "../../lib/authority/start.ts";

type ConsentRequired = Extract<JeroReviewStartResultV1, { kind: "consent_required" }>;

function consentRequired(): ConsentRequired {
	return {
		kind: "consent_required",
		action: "consent_required",
		target_identity: "sha256:" + "a".repeat(64),
		projection: "workspace",
		risk_level: "medium",
		changed_files: 3,
		changed_lines: 42,
		risk_evidence: ["a moderate amount of change"],
	};
}

test("consent invocation round-trips values containing spaces through token quoting", () => {
	const cwd = process.platform === "win32" ? "C:\\Users\\John Doe\\repo" : "/home/john doe/repo";
	const envelope = projectJeroConsentEnvelopeV1(consentRequired(), {
		cwd,
		untrackedScope: "select",
		expectedUntrackedInventory: "sha256:" + "b".repeat(64),
		intendedUntracked: ["my folder/notes.md", "plain.txt"],
	});
	assert.match(envelope.choices[0].invocation, /--cwd "C:\\Users\\John Doe\\repo"|--cwd "\/home\/john doe\/repo"/);
	assert.match(envelope.choices[0].invocation, /--intended-untracked="my folder\/notes\.md"/);

	const invocation = consentInvocationArguments({
		cwd,
		consent: envelope,
		answer: "granted",
	});
	const cwdToken = invocation.arguments_.find((token) => token === cwd);
	assert.ok(cwdToken !== undefined, "含空格的 cwd 必须以完整单词元往返（不得被分词截断）");
	assert.ok(invocation.arguments_.includes("--intended-untracked=my folder/notes.md"), "含空格的未跟踪路径必须以完整词元往返");
});

test("consent invocation stays byte-identical for values without spaces", () => {
	const envelope = projectJeroConsentEnvelopeV1(consentRequired(), {
		cwd: "F:\\work\\repo",
		untrackedScope: "exclude",
		expectedUntrackedInventory: "sha256:" + "c".repeat(64),
	});
	assert.doesNotMatch(envelope.choices[0].invocation, /"/, "无空白值不加引号——既有逐字节钉住的形态不变");
	const invocation = consentInvocationArguments({ cwd: "F:\\work\\repo", consent: envelope, answer: "granted" });
	assert.ok(invocation.arguments_.includes("F:\\work\\repo"), "反斜杠路径逐字保留");
});

test("consent invocation fails fast at projection time for double-quote values", () => {
	assert.throws(
		() => projectJeroConsentEnvelopeV1(consentRequired(), { cwd: 'C:\\we"ird\\repo' }),
		/double quote/,
		"双引号在解析文法下不可表示——提问侧 fail-fast 好过应答侧绑定失败",
	);
});
