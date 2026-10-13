import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deriveJeroFixApplicationV1 } from "../../lib/authority/fix-application.ts";
import type { JeroAuthorityContextV1 } from "../../lib/authority/review.ts";

// authority/fix-application 域测试：三条廉价拒绝路径（血统缺失/损坏/
// 非修复态）。derivation-failed 与成功路径需要 fixing 态权威夹具 + git
// 暂存，由评审环路 conformance 子进程覆盖。

function stubContext(load: () => { kind: string; detail?: string; record?: unknown }): JeroAuthorityContextV1 {
	return { lineages: { load } } as unknown as JeroAuthorityContextV1;
}

test("拒绝：血统不存在", () => {
	const context = stubContext(() => ({ kind: "missing" }));
	const outcome = deriveJeroFixApplicationV1(context, "lineage-x", join(tmpdir(), "nowhere"));
	assert.deepEqual(outcome, {
		kind: "refused",
		code: "lineage-missing",
		detail: "lineage lineage-x does not exist",
	});
});

test("拒绝：血统记录损坏", () => {
	const context = stubContext(() => ({ kind: "corrupted", detail: "ledger bytes drifted" }));
	const outcome = deriveJeroFixApplicationV1(context, "lineage-x", join(tmpdir(), "nowhere"));
	assert.equal(outcome.kind, "refused");
	assert.ok(outcome.kind === "refused" && outcome.code === "corrupted");
	assert.ok(outcome.kind === "refused" && outcome.detail === "ledger bytes drifted");
});

test("拒绝：血统不在修复态", () => {
	const state = { state: "started" };
	const context = stubContext(() => ({
		kind: "loaded",
		record: { state },
	}));
	const outcome = deriveJeroFixApplicationV1(context, "lineage-x", join(tmpdir(), "nowhere"));
	assert.equal(outcome.kind, "refused");
	assert.ok(outcome.kind === "refused" && outcome.code === "not-fixing");
	assert.match(outcome.kind === "refused" ? outcome.detail ?? "" : "", /fixing state/);
});

test("拒绝详情不泄漏仓库外路径语义（快照读取前短路）", () => {
	// 非修复态在读取快照存储之前短路：传入不存在的仓库根也不产生 IO 错误。
	const scratch = mkdtempSync(join(tmpdir(), "jero-fix-app-"));
	try {
		const context = stubContext(() => ({
			kind: "loaded",
			record: { state: { state: "final-verification" } },
		}));
		const outcome = deriveJeroFixApplicationV1(context, "lineage-x", scratch);
		assert.equal(outcome.kind, "refused");
	} finally {
		rmSync(scratch, { recursive: true, force: true });
	}
});
