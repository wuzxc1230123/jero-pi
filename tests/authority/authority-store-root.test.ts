import assert from "node:assert/strict";
import { existsSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import test from "node:test";
import { JERO_REPOSITORY_IDENTITY_SCHEMA } from "../../lib/authority/canonical.ts";
import { JERO_STORE_DIRECTORY_NAME, resolveJeroAuthorityStoreV1 } from "../../lib/authority/store-root.ts";
import { git, repository, tempRoot } from "./fixtures.ts";

test("resolves the jero authority store under the Git common directory", (t) => {
	const root = repository(t);
	const resolution = resolveJeroAuthorityStoreV1(root);
	assert.equal(resolution.kind, "ok");
	if (resolution.kind !== "ok") return;
	const commonDirectory = git(root, "rev-parse", "--path-format=absolute", "--git-common-dir");
	assert.equal(resolve(resolution.common_directory), resolve(commonDirectory));
	assert.equal(resolve(resolution.store_root), resolve(join(commonDirectory, JERO_STORE_DIRECTORY_NAME)));
	assert.equal(resolution.repository_identity.schema, JERO_REPOSITORY_IDENTITY_SCHEMA);
	assert.equal(resolution.repository_identity.object_format, git(root, "rev-parse", "--show-object-format"));
	assert.equal(resolution.repository_identity.root_commit_ids.length, 1);
	assert.match(resolution.repository_id, /^[0-9a-f]{64}$/);
	assert.match(resolution.authority_id, /^[0-9a-f]{64}$/);
	assert.notEqual(resolution.repository_id, resolution.authority_id);
});

test("jero repository identity is pinned once and reused on later resolutions", (t) => {
	const root = repository(t);
	const first = resolveJeroAuthorityStoreV1(root);
	const second = resolveJeroAuthorityStoreV1(root);
	assert.equal(first.kind, "ok");
	assert.equal(second.kind, "ok");
	if (first.kind !== "ok" || second.kind !== "ok") return;
	assert.equal(first.repository_id, second.repository_id);
	assert.equal(first.authority_id, second.authority_id);
	assert.deepEqual(first.repository_identity, second.repository_identity);
	assert.equal(existsSync(join(second.store_root, "IDENTITY")), true);
});

test("upstream gentle-ai review data is a foreign authority store and refuses resolution without writes", (t) => {
	const root = repository(t);
	const commonDirectory = git(root, "rev-parse", "--path-format=absolute", "--git-common-dir");
	const foreignReviews = join(commonDirectory, "gentle-ai", "reviews");
	mkdirSync(foreignReviews, { recursive: true });
	writeFileSync(join(foreignReviews, "IDENTITY"), "{}");
	const resolution = resolveJeroAuthorityStoreV1(root);
	assert.equal(resolution.kind, "foreign-authority-store");
	if (resolution.kind !== "foreign-authority-store") return;
	assert.ok(resolution.hits.includes("gentle-ai/reviews/IDENTITY"));
	// Fail-closed refusal must not create or migrate any jero state.
	assert.equal(existsSync(join(commonDirectory, JERO_STORE_DIRECTORY_NAME)), false);
});

test("an upstream compact transaction LOCK is a foreign authority store", (t) => {
	const root = repository(t);
	const commonDirectory = git(root, "rev-parse", "--path-format=absolute", "--git-common-dir");
	const foreignLock = join(commonDirectory, "gentle-ai", "review-transactions", "v2", "LOCK");
	mkdirSync(join(foreignLock, ".."), { recursive: true });
	writeFileSync(foreignLock, "lock");
	const resolution = resolveJeroAuthorityStoreV1(root);
	assert.equal(resolution.kind, "foreign-authority-store");
	if (resolution.kind !== "foreign-authority-store") return;
	assert.ok(resolution.hits.includes("gentle-ai/review-transactions/v2/LOCK"));
	assert.equal(existsSync(join(commonDirectory, JERO_STORE_DIRECTORY_NAME)), false);
});

test("a foreign authority store refuses resolution even after a jero store exists", (t) => {
	const root = repository(t);
	assert.equal(resolveJeroAuthorityStoreV1(root).kind, "ok");
	const commonDirectory = git(root, "rev-parse", "--path-format=absolute", "--git-common-dir");
	const foreignControl = join(commonDirectory, "gentle-ai", "reviews", "control");
	mkdirSync(foreignControl, { recursive: true });
	assert.equal(resolveJeroAuthorityStoreV1(root).kind, "foreign-authority-store");
});

test("non-Git directories fail closed as not-a-git-repository", (t) => {
	const outside = tempRoot("jero-authority-not-git-");
	try {
		const resolution = resolveJeroAuthorityStoreV1(outside);
		assert.equal(resolution.kind, "not-a-git-repository");
		if (resolution.kind === "not-a-git-repository") assert.match(resolution.detail, /not a git repository/i);
	} finally {
		rmSync(outside, { recursive: true, force: true });
	}
});

test("repositories without root commit anchors fail closed", (t) => {
	const parent = tempRoot("jero-authority-empty-repo-");
	const root = join(parent, "repo");
	mkdirSync(root);
	git(root, "init", "-b", "main");
	t.after(() => rmSync(parent, { recursive: true, force: true }));
	const resolution = resolveJeroAuthorityStoreV1(root);
	assert.equal(resolution.kind, "authority-unavailable");
	if (resolution.kind === "authority-unavailable") assert.match(resolution.detail, /root commit anchors/i);
});

test("an empty but existing upstream review-transactions directory is already a foreign store", (t) => {
	const root = repository(t);
	const commonDirectory = git(root, "rev-parse", "--path-format=absolute", "--git-common-dir");
	mkdirSync(join(commonDirectory, "gentle-ai", "review-transactions"), { recursive: true });
	const resolution = resolveJeroAuthorityStoreV1(root);
	assert.equal(resolution.kind, "foreign-authority-store");
	if (resolution.kind !== "foreign-authority-store") return;
	assert.deepEqual(resolution.hits, ["gentle-ai/review-transactions"]);
});

test("a symlinked upstream review store is reported, not followed into or crashed on", (t) => {
	const root = repository(t);
	const commonDirectory = git(root, "rev-parse", "--path-format=absolute", "--git-common-dir");
	const realData = tempRoot("jero-authority-foreign-real-");
	t.after(() => rmSync(realData, { recursive: true, force: true }));
	writeFileSync(join(realData, "IDENTITY"), "{}\n");
	mkdirSync(join(commonDirectory, "gentle-ai"), { recursive: true });
	symlinkSync(realData, join(commonDirectory, "gentle-ai", "reviews"), "junction");
	const resolution = resolveJeroAuthorityStoreV1(root);
	assert.equal(resolution.kind, "foreign-authority-store");
	if (resolution.kind !== "foreign-authority-store") return;
	assert.ok(resolution.hits.includes("gentle-ai/reviews/IDENTITY"));
});
