// review-candidate-view 测试共享夹具与助手：自 review-candidate-view.test.ts 机械平移（语义零改动）。

import { default as assert } from "node:assert/strict";
import { default as childProcess, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	chmodSync, default as fs, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync,
	readFileSync, realpathSync, renameSync, rmSync, symlinkSync, utimesSync, writeFileSync
} from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { default as test } from "node:test";
import { gzipSync } from "node:zlib";
import {
	type CandidateGitExecutor, CandidateViewError, CandidateViewRegistry, CANONICAL_GZIP_OPTIONS,
	createCandidateView, decodeCandidateContextManifest, deriveChangedPathManifest,
	digestChangedPathManifest, hasExpectedExecutableBits, injectReviewCandidateView,
	type NativeCandidateProjectionDescriptor, readCandidateContextManifestPage
} from "../lib/review-candidate-view.ts";
import {
	type WindowsAclAuthority,
	assertCandidateOwnerParent, assertTrustedWindowsOwner, prepareCandidateOwnerParent,
	setWindowsAclAuthorityForTesting, validatePrivateWindowsDacl, validatePrivateWindowsOwner,
	WindowsDaclValidationError, WindowsOwnerValidationError
} from "../lib/review-candidate-view-owner.ts";


export function git(cwd: string, ...arguments_: string[]): string {
	return execFileSync("git", arguments_, { cwd, encoding: "utf8" }).trim();
}

export function repository(t: test.TestContext): string {
	const cwd = mkdtempSync(join(tmpdir(), "gentle-pi-candidate-view-"));
	t.after(() => {
		if (process.platform !== "win32") execFileSync("chmod", ["-R", "u+rwx", cwd]);
		rmSync(cwd, { recursive: true, force: true });
	});
	git(cwd, "init", "-b", "main");
	writeFileSync(join(cwd, "tracked.txt"), "base\n");
	git(cwd, "add", "tracked.txt");
	git(cwd, "-c", "user.name=Candidate Test", "-c", "user.email=candidate@example.invalid", "commit", "-m", "base");
	return cwd;
}

export function ownerMarker(root: string): string { return `${root}.owner.json`; }

// Windows 真实 ACL 权威（PowerShell/icacls/reg.exe 子进程，单次秒级）
// 只是少数 win32 专属端到端用例的测试对象；语义用例若走真栈，每个
// 创建/清理周期要付出数十次子进程（整套件数十分钟）。因此 win32 上
// 进程加载即打桩，各打桩用例的恢复钩子同样恢复到打桩而非真实权威。
export const noopWindowsAclAuthority: WindowsAclAuthority = () => {};
if (process.platform === "win32") setWindowsAclAuthorityForTesting(noopWindowsAclAuthority);

export function mockWindowsAcl(t: test.TestContext): void {
	setWindowsAclAuthorityForTesting(noopWindowsAclAuthority);
	t.after(() => setWindowsAclAuthorityForTesting(noopWindowsAclAuthority));
}

// 需要 PowerShell/icacls 真栈的 win32 专属端到端用例（真实所有者读取、
// 外部所有者拒绝、强制清理无关授权、伪装 SystemRoot、DACL 回读）用
// 此助手在用例期间清除打桩，结束时恢复默认打桩。
export function useRealWindowsAclAuthority(t: test.TestContext): void {
	setWindowsAclAuthorityForTesting();
	t.after(() => setWindowsAclAuthorityForTesting(noopWindowsAclAuthority));
}

export function orphanFixture(t: test.TestContext) {
	const cwd = repository(t);
	const registry = new CandidateViewRegistry();
	const view = registry.create({ contributorRoot: cwd });
	const marker = ownerMarker(view.root);
	const owner = JSON.parse(readFileSync(marker, "utf8"));
	owner.pid = 2147483000;
	writeFileSync(marker, JSON.stringify(owner));
	return { cwd, registry, view, marker, owner };
}

export function mockOwnerProbe(t: test.TestContext, code?: string): void {
	t.mock.method(process, "kill", () => {
		if (code) throw Object.assign(new Error("fixture probe"), { code });
		return true;
	});
}

// 测试助手必须住在 shared：分片若为取助手而 import 另一分片，
// 该分片的顶层 test() 注册会在导入方进程里再执行一遍，整套件
// 被成倍重跑（见 split-test.mjs 的超集导入策略）。

// An unborn repository has a symbolic HEAD pointing at a branch with no
// commits yet; its review base is Git's repository-native empty tree, not a
// missing or malformed commit. `mktree` with empty input derives that empty
// tree object-format-aware (sha1 or sha256) without hardcoding the SHA-1 id.
export function emptyTreeOf(cwd: string): string {
	return execFileSync("git", ["-C", cwd, "mktree"], { encoding: "utf8", input: "" }).trim();
}

export function unbornRepository(t: test.TestContext, stage = true): string {
	const cwd = mkdtempSync(join(tmpdir(), "gentle-pi-candidate-view-unborn-"));
	t.after(() => rmSync(cwd, { recursive: true, force: true }));
	git(cwd, "init", "-b", "main");
	git(cwd, "config", "user.name", "Candidate Test");
	git(cwd, "config", "user.email", "candidate@example.invalid");
	if (stage) {
		writeFileSync(join(cwd, "staged.txt"), "first staged\n");
		git(cwd, "add", "staged.txt");
	}
	return cwd;
}

