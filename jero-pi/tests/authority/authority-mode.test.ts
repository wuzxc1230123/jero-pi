import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { canonicalJsonV1 } from "../../lib/review-canonical.ts";
import { getJeroReviewModeV1, setJeroReviewModeV1 } from "../../lib/authority/mode.ts";
import { createJeroAuthorityReviewCli } from "../../lib/jero-authority-cli.ts";
import { JERO_REVIEW_MODE_RECORD_SCHEMA } from "../../lib/authority/protocol.ts";
import { repository } from "./fixtures.ts";

// Spec §I.8: review-mode get/set — clone-scoped mutations only, typed result
// mirroring NativeReviewModeResult {operation, scope, status:{global,
// cloneLocal, effective, source, revision?, reach?}}. Tests pin the global
// path into the fixture tree so the real config home is never touched.

test("default mode is ON with source default when neither global nor clone is set (F4, upstream parity)", (t) => {
	const repo = repository(t);
	const globalPath = join(repo, "..", "global-mode.json");
	t.after(() => rmSync(globalPath, { force: true }));
	const outcome = getJeroReviewModeV1(repo, { globalModePath: globalPath });
	assert.equal(outcome.kind, "ok");
	if (outcome.kind !== "ok") return;
	assert.deepEqual(outcome.result, {
		operation: "status",
		scope: "both",
		status: { global: "", cloneLocal: "", effective: "on", source: "default" },
	});
});

test("set writes ONLY the clone-scoped record under the jero authority store", (t) => {
	const repo = repository(t);
	const globalPath = join(repo, "..", "global-mode.json");
	t.after(() => rmSync(globalPath, { force: true }));
	const outcome = setJeroReviewModeV1(repo, "on", { globalModePath: globalPath });
	assert.equal(outcome.kind, "ok");
	if (outcome.kind !== "ok") return;
	assert.equal(outcome.result.operation, "enable");
	assert.equal(outcome.result.scope, "clone");
	assert.equal(outcome.result.status.cloneLocal, "on");
	assert.equal(outcome.result.status.effective, "on");
	assert.equal(outcome.result.status.source, "clone_local");
	assert.match(outcome.result.status.revision ?? "", /^sha256:[0-9a-f]{64}$/);
	assert.equal(outcome.result.status.reach, "this_build");
	// The clone record lands at <store>/review-mode.json — never the global path.
	const storeDir = join(repo, ".git", "jero-review");
	assert.equal(existsSync(join(storeDir, "review-mode.json")), true);
	assert.equal(existsSync(globalPath), false);
	// F11: the atomic temp+rename write leaves no staging residue behind.
	assert.deepEqual(readdirSync(storeDir).filter((entry) => entry.includes("tmp")), []);
	// Disable flips back and reports the same clone scope.
	const off = setJeroReviewModeV1(repo, "off", { globalModePath: globalPath });
	assert.equal(off.kind, "ok");
	if (off.kind === "ok") {
		assert.equal(off.result.operation, "disable");
		assert.equal(off.result.status.effective, "off");
		assert.equal(off.result.status.cloneLocal, "off");
	}
});

test("a global mode value is read but never written by M2", (t) => {
	const repo = repository(t);
	const globalPath = join(repo, "..", "global-mode.json");
	t.after(() => rmSync(globalPath, { force: true }));
	writeFileSync(globalPath, canonicalJsonV1({ schema: JERO_REVIEW_MODE_RECORD_SCHEMA, value: "on" }));
	const outcome = getJeroReviewModeV1(repo, { globalModePath: globalPath });
	assert.equal(outcome.kind, "ok");
	if (outcome.kind !== "ok") return;
	assert.equal(outcome.result.status.global, "on");
	assert.equal(outcome.result.status.effective, "on");
	assert.equal(outcome.result.status.source, "global");
	assert.equal(outcome.result.status.reach, "machine");
	// clone-local wins over global.
	const set = setJeroReviewModeV1(repo, "off", { globalModePath: globalPath });
	if (set.kind === "ok") {
		assert.equal(set.result.status.effective, "off");
		assert.equal(set.result.status.source, "clone_local");
	}
});

test("a corrupted mode record fails closed instead of degrading to off", (t) => {
	const repo = repository(t);
	const globalPath = join(repo, "..", "global-mode.json");
	t.after(() => rmSync(globalPath, { force: true }));
	writeFileSync(globalPath, "{not json");
	const corrupted = getJeroReviewModeV1(repo, { globalModePath: globalPath });
	assert.equal(corrupted.kind, "refused");
	if (corrupted.kind === "refused") assert.equal(corrupted.code, "mode-record-corrupted");
	// A corrupted clone record refuses too.
	const storeRoot = join(repo, ".git", "jero-review");
	mkdirSync(storeRoot, { recursive: true });
	writeFileSync(join(storeRoot, "review-mode.json"), "[]");
	const cloneCorrupted = getJeroReviewModeV1(repo, { globalModePath: globalPath });
	assert.equal(cloneCorrupted.kind, "refused");
	if (cloneCorrupted.kind === "refused") assert.equal(cloneCorrupted.code, "mode-record-corrupted");
});

test("set refuses invalid values and non-repository directories", (t) => {
	const repo = repository(t);
	const globalPath = join(repo, "..", "global-mode.json");
	t.after(() => rmSync(globalPath, { force: true }));
	const invalid = setJeroReviewModeV1(repo, "sometimes" as never, { globalModePath: globalPath });
	assert.equal(invalid.kind, "refused");
	if (invalid.kind === "refused") assert.equal(invalid.code, "mode-value-invalid");
	const nowhere = setJeroReviewModeV1(join(repo, "nope"), "on");
	assert.equal(nowhere.kind, "refused");
	if (nowhere.kind === "refused") assert.ok(nowhere.code === "not-a-git-repository" || nowhere.code === "git-unavailable");
});

test("the persisted record is the strict jero.authority.review-mode/v1 shape", (t) => {
	const repo = repository(t);
	const globalPath = join(repo, "..", "global-mode.json");
	t.after(() => rmSync(globalPath, { force: true }));
	setJeroReviewModeV1(repo, "on", { globalModePath: globalPath });
	const parsed = JSON.parse(readFileSync(join(repo, ".git", "jero-review", "review-mode.json"), "utf8"));
	assert.deepEqual(parsed, { schema: JERO_REVIEW_MODE_RECORD_SCHEMA, value: "on" });
});

test("the cli seam honors JERO_PI_CONFIG_HOME for the global mode record", async (t) => {
	const repo = repository(t);
	const configHome = join(repo, "..", "jero-config-home");
	mkdirSync(configHome, { recursive: true });
	t.after(() => rmSync(configHome, { recursive: true, force: true }));
	writeFileSync(join(configHome, "review-mode.json"), canonicalJsonV1({ schema: JERO_REVIEW_MODE_RECORD_SCHEMA, value: "off" }));
	const previous = process.env.JERO_PI_CONFIG_HOME;
	process.env.JERO_PI_CONFIG_HOME = configHome;
	t.after(() => {
		if (previous === undefined) delete process.env.JERO_PI_CONFIG_HOME;
		else process.env.JERO_PI_CONFIG_HOME = previous;
	});
	const cli = createJeroAuthorityReviewCli();
	const result = await cli.reviewMode!({ cwd: repo, operation: "status" });
	assert.equal(result.status.global, "off");
	assert.equal(result.status.effective, "off");
	assert.equal(result.status.source, "global");
});

test("set 之后的 get 走真文件往返：写入必须是读侧接受的正典字节（无尾随换行）", async (t) => {
	const repo = repository(t);
	const globalPath = join(repo, "..", "global-mode.json");
	t.after(() => rmSync(globalPath, { force: true }));
	// 回归钉住（真机冒烟发现）：写侧曾追加 "\n" 而读侧 parseCanonicalJsonV1
	// 逐字节比对——set 一次后每次 get 都判 mode-record-corrupted，START 的
	// 模式门随之 fail-closed。此前的持久化测试用宽容的 JSON.parse 读文件，
	// 从未走过"权威写 → 权威读"的真往返，故全绿共存。
	assert.equal(setJeroReviewModeV1(repo, "on", { globalModePath: globalPath }).kind, "ok");
	const afterOn = getJeroReviewModeV1(repo, { globalModePath: globalPath });
	assert.equal(afterOn.kind, "ok", `set(on) 后 get 必须可读（曾判损坏:${afterOn.kind === "refused" ? String(afterOn.detail) : ""}）`);
	if (afterOn.kind === "ok") {
		assert.equal(afterOn.result.status.effective, "on");
		assert.equal(afterOn.result.status.source, "clone_local");
	}
	assert.equal(setJeroReviewModeV1(repo, "off", { globalModePath: globalPath }).kind, "ok");
	const afterOff = getJeroReviewModeV1(repo, { globalModePath: globalPath });
	assert.equal(afterOff.kind, "ok");
	if (afterOff.kind === "ok") {
		assert.equal(afterOff.result.status.effective, "off");
		assert.equal(afterOff.result.status.source, "clone_local");
	}
	// CLI 缝同律：命令路径的 status 读的正是同一份落盘记录。
	const cli = createJeroAuthorityReviewCli();
	const cliStatus = await cli.reviewMode!({ cwd: repo, operation: "status" });
	assert.equal(cliStatus.status.effective, "off");
});
