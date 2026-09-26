// 轻量 change（P1.1）的权威路径测试：`.jero-lightweight` 规范常规文件在
// changeRoot 声明显式豁免——proposal + tasks 即可 apply-ready；specs/design
// 不再是阻塞；无 delta specs 时 sync not_applicable、archive 不要求
// sync-report。三层覆盖：磁盘引擎（resolveSddStatus）→ 权威投影
// （jeroSddStatusV1 / jeroSddContinueV1）→ 线上解码器
// （decodeNativeSddStatusV2 的 lightweight 布尔校验）。既有非轻量行为
// 在 authority-sdd-status.test.ts 与根目录 sdd-status 测试中锁定，此处
// 只钉轻量分叉，二者共同构成 gentle-pi.sdd-status@1 的完整契约语义。
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { decodeNativeSddStatusV2 } from "../../lib/authority/client-contract.ts";
import { jeroSddContinueV1 } from "../../lib/authority/sdd-continue.ts";
import { jeroSddStatusV1 } from "../../lib/authority/sdd-status.ts";
import { resolveJeroAuthorityContextV1, type JeroAuthorityContextV1 } from "../../lib/authority/review.ts";
import { resolveSddStatus } from "../../lib/sdd-status.ts";

function tempRoot(prefix: string): string {
	return mkdtempSync(join(tmpdir(), prefix));
}

// 与 authority-sdd-status.test.ts 同形的最小 git 化 harness：权威上下文
// 解析需要仓库身份。
function lightweightHarness(lightweight: boolean): { repo: string; context: JeroAuthorityContextV1 } {
	const parent = tempRoot("jero-sdd-light-");
	const repo = join(parent, "repo");
	mkdirSync(repo, { recursive: true });
	const git = (...args: string[]) => execFileSync("git", args, { cwd: repo, stdio: "ignore" });
	git("init", "-b", "main");
	writeFileSync(join(repo, "README.md"), "x\n");
	git("add", ".");
	git("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-m", "init");
	const change = join(repo, "openspec", "changes", "fix-typo");
	mkdirSync(change, { recursive: true });
	writeFileSync(join(change, "proposal.md"), "# Proposal\nFix the login typo.\n");
	writeFileSync(join(change, "tasks.md"), "- [ ] fix the typo\n");
	if (lightweight) writeFileSync(join(change, ".jero-lightweight"), "");
	return { repo, context: mustContext(repo) };
}

function mustContext(repo: string): JeroAuthorityContextV1 {
	const resolution = resolveJeroAuthorityContextV1(repo);
	if (resolution.kind !== "ok") throw new Error(`resolve refused: ${resolution.code}`);
	return resolution.context;
}

test("lightweight marker makes proposal+tasks apply-ready without specs or design", (t) => {
	const { repo } = lightweightHarness(true);
	t.after(() => rmSync(join(repo, ".."), { recursive: true, force: true }));
	const status = resolveSddStatus({ cwd: repo, changeName: "fix-typo" });
	assert.equal(status.lightweight, true);
	assert.equal(status.applyState, "ready");
	assert.equal(status.nextRecommended, "sdd-apply");
	assert.deepEqual(status.blockedReasons, [], "waived artifacts must not appear as blockers");
	assert.equal(status.dependencies.sync, "not_applicable", "no delta specs means sync has no object");
});

test("without the marker the same tree stays blocked on specs and design", (t) => {
	const { repo } = lightweightHarness(false);
	t.after(() => rmSync(join(repo, ".."), { recursive: true, force: true }));
	const status = resolveSddStatus({ cwd: repo, changeName: "fix-typo" });
	assert.equal(status.lightweight, undefined);
	assert.equal(status.applyState, "blocked");
	assert.equal(status.nextRecommended, "sdd-spec");
	assert.ok(status.blockedReasons.some((reason) => reason.includes("domain specs")));
	assert.ok(status.blockedReasons.some((reason) => reason.includes("design.md")));
});

test("a directory-shaped marker is conservatively not a lightweight declaration", (t) => {
	const { repo } = lightweightHarness(false);
	mkdirSync(join(repo, "openspec", "changes", "fix-typo", ".jero-lightweight"), { recursive: true });
	t.after(() => rmSync(join(repo, ".."), { recursive: true, force: true }));
	const status = resolveSddStatus({ cwd: repo, changeName: "fix-typo" });
	assert.equal(status.lightweight, undefined);
	assert.equal(status.applyState, "blocked");
});

test("lightweight with all tasks checked and a passing verify routes straight to archive", (t) => {
	const { repo } = lightweightHarness(true);
	const change = join(repo, "openspec", "changes", "fix-typo");
	writeFileSync(join(change, "tasks.md"), "- [x] fix the typo\n");
	writeFileSync(join(change, "verify-report.md"), "status: PASS\n");
	t.after(() => rmSync(join(repo, ".."), { recursive: true, force: true }));
	const status = resolveSddStatus({ cwd: repo, changeName: "fix-typo" });
	assert.equal(status.applyState, "all_done");
	assert.equal(status.dependencies.verify, "all_done");
	assert.equal(status.dependencies.sync, "not_applicable");
	assert.equal(status.dependencies.archive, "ready", "archive must not demand a sync report when sync is not applicable");
	assert.equal(status.nextRecommended, "sdd-archive");
});

test("lightweight with delta specs keeps the normal sync phase", (t) => {
	const { repo } = lightweightHarness(true);
	const change = join(repo, "openspec", "changes", "fix-typo");
	mkdirSync(join(change, "specs", "auth"), { recursive: true });
	writeFileSync(join(change, "specs", "auth", "spec.md"), "## Purpose\nfix the typo contract\n");
	writeFileSync(join(change, "tasks.md"), "- [x] fix the typo\n");
	writeFileSync(join(change, "verify-report.md"), "status: PASS\n");
	t.after(() => rmSync(join(repo, ".."), { recursive: true, force: true }));
	const status = resolveSddStatus({ cwd: repo, changeName: "fix-typo" });
	assert.equal(status.dependencies.sync, "ready", "specs present means sync has an object even for lightweight changes");
	assert.equal(status.nextRecommended, "sdd-sync");
	assert.equal(status.dependencies.archive, "blocked");
});

test("planning recommendation for a lightweight change skips the spec and design rungs", (t) => {
	const { repo } = lightweightHarness(true);
	writeFileSync(join(repo, "openspec", "changes", "fix-typo", "tasks.md"), "");
	t.after(() => rmSync(join(repo, ".."), { recursive: true, force: true }));
	const status = resolveSddStatus({ cwd: repo, changeName: "fix-typo" });
	assert.equal(status.nextRecommended, "sdd-tasks", "with proposal done and tasks empty the ladder goes straight to tasks");
});

test("authority projection carries the lightweight flag and continues a lightweight change", (t) => {
	const { repo, context } = lightweightHarness(true);
	t.after(() => rmSync(join(repo, ".."), { recursive: true, force: true }));
	const result = jeroSddStatusV1(context, { workspaceRoot: repo, changeName: "fix-typo" });
	assert.equal(result.kind, "ok");
	if (result.kind !== "ok") return;
	assert.equal(result.status.lightweight, true);
	assert.equal(result.status.nextRecommended, "apply");
	const continued = jeroSddContinueV1(context, { workspaceRoot: repo, changeName: "fix-typo" });
	assert.equal(continued.kind, "ok", "a lightweight change is continuable through the transition projection");
});

test("authority projection omits the flag for ordinary changes", (t) => {
	const { repo, context } = lightweightHarness(false);
	t.after(() => rmSync(join(repo, ".."), { recursive: true, force: true }));
	const result = jeroSddStatusV1(context, { workspaceRoot: repo, changeName: "fix-typo" });
	assert.equal(result.kind, "ok");
	if (result.kind !== "ok") return;
	assert.equal("lightweight" in result.status, false, "the wire stays sparse for ordinary changes");
});

test("decoder passes a projected lightweight record and rejects a malformed flag", (t) => {
	const { repo, context } = lightweightHarness(true);
	t.after(() => rmSync(join(repo, ".."), { recursive: true, force: true }));
	const projected = jeroSddStatusV1(context, { workspaceRoot: repo, changeName: "fix-typo" });
	if (projected.kind !== "ok") throw new Error("projection refused");
	const decoded = decodeNativeSddStatusV2(projected.status, { workspaceRoot: repo, changeName: "fix-typo" });
	assert.equal(decoded.lightweight, true);

	const malformed = { ...projected.status, lightweight: "yes" };
	assert.throws(
		() => decodeNativeSddStatusV2(malformed, { workspaceRoot: repo, changeName: "fix-typo" }),
		/lightweight flag must be a boolean/,
	);
});
