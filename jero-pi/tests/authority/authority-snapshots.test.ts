import { test } from "node:test";
import assert from "node:assert/strict";
import {
	jeroPathsDigestV1,
	jeroReviewPolicyHashV1,
	jeroUntrackedInventoryDigestV1,
} from "../../lib/authority/snapshots.ts";

// authority/snapshots 域测试：策略哈希与两个纯摘要——排序不变性、
// 集合区分度与域隔离。deriveJeroReviewSnapshotV1 的 git 路径由 conformance
// 与评审环路子进程覆盖。

test("jeroReviewPolicyHashV1：64 位十六进制、模式区分、确定性", () => {
	const ordinary = jeroReviewPolicyHashV1("ordinary");
	const judgmentDay = jeroReviewPolicyHashV1("judgment-day");
	assert.match(ordinary, /^[0-9a-f]{64}$/);
	assert.match(judgmentDay, /^[0-9a-f]{64}$/);
	assert.notEqual(ordinary, judgmentDay);
	assert.equal(jeroReviewPolicyHashV1("ordinary"), ordinary);
});

test("jeroUntrackedInventoryDigestV1：排序不变、集合区分、域前缀", () => {
	const digest = jeroUntrackedInventoryDigestV1(["b.txt", "a.txt"]);
	assert.match(digest, /^sha256:[0-9a-f]{64}$/);
	// 顺序不影响摘要——清点只看集合。
	assert.equal(jeroUntrackedInventoryDigestV1(["a.txt", "b.txt"]), digest);
	assert.equal(jeroUntrackedInventoryDigestV1([]), jeroUntrackedInventoryDigestV1([]));
	assert.notEqual(jeroUntrackedInventoryDigestV1(["a.txt"]), digest);
	// 相同名单在不同摘要域下必须不同（untracked vs paths）。
	assert.notEqual(jeroUntrackedInventoryDigestV1(["a.txt"]), jeroPathsDigestV1(["a.txt"]));
});

test("jeroPathsDigestV1：排序不变与多路径区分", () => {
	const digest = jeroPathsDigestV1(["src/z.ts", "src/a.ts"]);
	assert.match(digest, /^sha256:[0-9a-f]{64}$/);
	assert.equal(jeroPathsDigestV1(["src/a.ts", "src/z.ts"]), digest);
	assert.notEqual(jeroPathsDigestV1(["src/a.ts"]), digest);
	assert.notEqual(jeroPathsDigestV1(["src/a.ts", "src/b.ts"]), digest);
});
