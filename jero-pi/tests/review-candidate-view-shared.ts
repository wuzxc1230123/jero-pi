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
	assertCandidateOwnerParent, assertTrustedWindowsOwner, prepareCandidateOwnerParent,
	setWindowsAclAuthorityForTesting, validatePrivateWindowsDacl, validatePrivateWindowsOwner,
	WindowsDaclValidationError, WindowsOwnerValidationError
} from "../lib/review-candidate-view-owner.ts";
import { commitFileAfterBase, compactCandidateContextManifest, emptyTreeOf, publicationFailure, unbornRepository } from "./review-candidate-view.test.ts";
import {
	baseTreeOf, bindingFailureRegistry, type CandidateViewRegistryInternals,
	candidateViewWorktreeCount, materializationFailureRegistry, stagedFinalizeDescriptor, treeOf
} from "./review-candidate-view.z3.test.ts";


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

export function mockWindowsAcl(t: test.TestContext): void {
	setWindowsAclAuthorityForTesting(() => {});
	t.after(() => setWindowsAclAuthorityForTesting());
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

