// 候选视图物料化：私有索引播种、worktree 检出与记录安全断言。
// 自 lib/review-candidate-view.ts 拆分（机械平移，语义零改动）。

import {
	randomUUID
} from "node:crypto";
import {
	copyFileSync,
	existsSync,
	lstatSync,
	mkdtempSync,
	readdirSync,
	realpathSync,
	rmSync,
	utimesSync
} from "node:fs";
import {
	tmpdir
} from "node:os";
import {
	basename,
	dirname,
	join,
	resolve
} from "node:path";
import {
	assertCandidateOwnerParent,
	type CandidateViewOwner,
	createCandidateOwner,
	removeCandidateOwner,
	samePath,
	sweepCandidateOwners
} from "./review-candidate-view-owner.ts";
import {
	addUnbornWorktree,
	candidateDirectories,
	type CandidateGitExecutor,
	CandidateViewError,
	candidateViewParent,
	type CandidateViewRecord,
	checkoutMaterializedEntries,
	type CreateCandidateViewRequest,
	deriveChangedScope,
	entryContentHash,
	git,
	gitPathTokens,
	hasExpectedExecutableBits,
	isCanonicalObjectId,
	isSafeCandidatePath,
	isWithin,
	makeReadonly,
	makeWritableForCleanup,
	parseTree,
	PRIVATE_INDEX_RACY_BACKDATE_NS,
	PRIVATE_INDEX_RACY_SAFETY_NS,
	resolveCandidateBase
} from "./review-candidate-view-git.ts";
function normalizeIntendedUntracked(paths: readonly string[] | undefined): readonly string[] | undefined {
	if (paths === undefined) return undefined;
	if (!Array.isArray(paths) || paths.some((path) => !isSafeCandidatePath(path)) || new Set(paths).size !== paths.length) {
		throw new CandidateViewError("candidate intended-untracked selection is invalid");
	}
	return Object.freeze([...paths]);
}

function isErrnoCode(error: unknown, code: string): boolean {
	return typeof error === "object" && error !== null && "code" in error && error.code === code;
}

function timestampSeconds(timestampNs: bigint): number {
	// Node 的 utimes API 接受以数字表示的 Unix 秒。拆分数值可保持
	// 秒转换精确；下面明确的 racy-clean 回拨远大于
	// Number 在该时期能表示的小数精度。
	return Number(timestampNs / 1_000_000_000n) + Number(timestampNs % 1_000_000_000n) / 1_000_000_000;
}

function seedPrivateIndexFromLiveIndex(cwd: string, indexPath: string, executor: CandidateGitExecutor): boolean {
	const liveIndex = resolve(cwd, git(cwd, ["rev-parse", "--path-format=absolute", "--git-path", "index"], process.env, executor));
	const entry = lstatSync(liveIndex, { bigint: true, throwIfNoEntry: false });
	if (entry === undefined) return false; if (!entry.isFile()) throw new CandidateViewError("candidate live Git index is not a regular file");
	if (entry.mtimeNs < PRIVATE_INDEX_RACY_BACKDATE_NS) throw new CandidateViewError("candidate live Git index timestamp is too early for racy-clean protection");
	copyFileSync(liveIndex, indexPath);
	// Git 的 racy-clean 检查比较索引与被跟踪文件的 mtime。copyFileSync
	// 会给私有索引新时间戳；恢复 Date 还会丢失
	// 纳秒。改为回拨 bigint 的活跃时间戳，然后验证
	// 文件系统应用了足够大的有界区间，使 Git 刷新
	// 内容而不是信任一个 racy-clean 的 stat 匹配。
	utimesSync(indexPath, timestampSeconds(entry.atimeNs), timestampSeconds(entry.mtimeNs - PRIVATE_INDEX_RACY_BACKDATE_NS));
	const privateMtimeNs = lstatSync(indexPath, { bigint: true }).mtimeNs;
	if (privateMtimeNs >= entry.mtimeNs || entry.mtimeNs - privateMtimeNs < PRIVATE_INDEX_RACY_SAFETY_NS) {
		throw new CandidateViewError("candidate private Git index timestamp cannot preserve racy-clean protection");
	}
	for (const name of readdirSync(dirname(liveIndex))) if (/^sharedindex\.[0-9a-f]+$/.test(name)) {
		try {
			const sharedIndex = join(dirname(liveIndex), name);
			if (lstatSync(sharedIndex).isFile()) copyFileSync(sharedIndex, join(dirname(indexPath), name));
		} catch (error) {
			if (!isErrnoCode(error, "ENOENT")) throw error;
		}
	}
	return true;
}

export function materializeCandidateView(request: CreateCandidateViewRequest, executor: CandidateGitExecutor, platform: NodeJS.Platform = process.platform): CandidateViewRecord {
	const contributorRoot = realpathSync(request.contributorRoot);
	if (!lstatSync(contributorRoot).isDirectory()) throw new CandidateViewError("contributor root is not a directory");
	if (request.committedOnly === true && request.baseRef === undefined) throw new CandidateViewError("committed-only candidate views require an explicit base reference", "committed-only-base-required");
	const commonDir = resolve(contributorRoot, git(contributorRoot, ["rev-parse", "--git-common-dir"], process.env, executor));
	const canonicalCommonDir = realpathSync(commonDir);
	const base = resolveCandidateBase(contributorRoot, request.baseRef, process.env, executor);
	const committedOnly = request.committedOnly === true;
	const intendedUntracked = normalizeIntendedUntracked(request.intendedUntracked);
	const candidateCommit = committedOnly
		? resolveCandidateBase(contributorRoot, "HEAD", process.env, executor)
		: base;
	const parent = candidateViewParent(canonicalCommonDir, platform);
	sweepCandidateOwners(canonicalCommonDir, (args) => git(canonicalCommonDir, args, process.env, executor), makeWritableForCleanup, platform);
	const index = mkdtempSync(join(tmpdir(), "jero-candidate-index-"));
	const indexPath = join(index, "index");
	const environment = { ...process.env, GIT_INDEX_FILE: indexPath };
	try {
		const baseCommit = base.commit;
		const unborn = baseCommit === "HEAD";
		// 工作区候选用解析出的活跃索引播种其隔离索引；缺失索引时使用冻结基线。
		const seededFromLiveIndex = !committedOnly && intendedUntracked !== undefined && seedPrivateIndexFromLiveIndex(contributorRoot, indexPath, executor);
		if (!seededFromLiveIndex) {
			// 未诞生仓库的基线树是 Git 的空树，因此用
			// `--empty` 而不是不存在的提交为私有候选
			// 索引播种。
			if (unborn) git(contributorRoot, ["read-tree", "--empty"], environment, executor);
			else git(contributorRoot, ["read-tree", candidateCommit.commit], environment, executor);
		}
		if (!committedOnly) {
			if (intendedUntracked === undefined) git(contributorRoot, ["add", "-A"], environment, executor);
			else {
				git(contributorRoot, ["add", "-u"], environment, executor);
				if (intendedUntracked.length > 0) git(contributorRoot, ["add", "--", ...intendedUntracked], { ...environment, GIT_LITERAL_PATHSPECS: "1" }, executor);
			}
		}
		const candidateTree = git(contributorRoot, ["write-tree"], environment, executor);
		const root = join(parent, randomUUID());
		let owner: CandidateViewOwner;
		try {
			owner = createCandidateOwner(canonicalCommonDir, root, platform);
		} catch (error) {
			throw new CandidateViewError("candidate view owner preparation failed", "candidate-owner-preparation-failed", undefined, { cause: error });
		}
		// 工作树与随后的 read-tree 物化处于同一个
		// try/catch 清理边界内。addUnbornWorktree 的
		// 回退路径可能已用 `worktree add` 注册了工作树却在
		// 后续步骤失败（例如 `symbolic-ref`）；把创建
		// 移到这里确保这类部分注册会被下面的 catch
		// 移除，而不是泄漏已注册/管理的工作树与目录。
		try {
			// 未诞生仓库没有可供工作树分离的提交。addUnbornWorktree
			// 创建孤儿工作树（未诞生分支、无提交、无引用）来承载
			// 物化的候选树而不产生幻影提交，并为不支持
			// --orphan 的 2.42 之前 Git 版本提供回退。
			if (unborn) addUnbornWorktree(contributorRoot, root, `jero-candidate-${randomUUID()}`, process.env, executor);
			else git(contributorRoot, ["worktree", "add", "--detach", "--no-checkout", root, candidateCommit.commit], process.env, executor);
			git(root, ["read-tree", candidateTree], process.env, executor);
			const tree = parseTree(root, candidateTree, executor);
			checkoutMaterializedEntries(root, tree.entries, executor);
			const entries = tree.entries.map((entry) => ({ ...entry, contentHash: entryContentHash(root, entry) }));
			const scope = deriveChangedScope(contributorRoot, base.tree, candidateTree, [...tree.entries, ...tree.gitlinks], executor);
			for (const gitlink of tree.gitlinks) if (lstatSync(join(root, gitlink.path), { throwIfNoEntry: false })) throw new CandidateViewError("candidate view materialized a metadata-only gitlink");
			makeReadonly(root, entries);
			return { owner, token: basename(root), root: realpathSync(root), parent, contributorRoot, commonDir: canonicalCommonDir, baseCommit, baseTree: base.tree, candidateTree, committedOnly, intendedUntracked, entries, gitlinks: tree.gitlinks, scope, gitExecutor: executor };
		} catch (error) {
			try { removeCandidateOwner(owner, (args) => git(canonicalCommonDir, args, process.env, executor), makeWritableForCleanup, false, platform); } catch { /* 保守恢复时保留标记与任何部分工作树。 */ }
			throw error;
		}
	} finally {
		rmSync(index, { recursive: true, force: true });
	}
}

export function assertRecordSafe(record: CandidateViewRecord, platform: NodeJS.Platform = process.platform): void {
	try {
		const contributor = lstatSync(record.contributorRoot);
		if (!contributor.isDirectory() || contributor.isSymbolicLink() || realpathSync(record.contributorRoot) !== record.contributorRoot) {
			throw new CandidateViewError("candidate contributor root identity changed", "contributor-root-drift");
		}
		const toplevel = realpathSync(git(record.contributorRoot, ["rev-parse", "--show-toplevel"], process.env, record.gitExecutor));
		const commonDir = realpathSync(resolve(record.contributorRoot, git(record.contributorRoot, ["rev-parse", "--git-common-dir"], process.env, record.gitExecutor)));
		if (!samePath(toplevel, record.contributorRoot, platform) || !samePath(commonDir, record.commonDir, platform)) {
			throw new CandidateViewError("candidate contributor root Git identity changed", "contributor-root-drift");
		}
	} catch (error) {
		if (error instanceof CandidateViewError) throw error;
		throw new CandidateViewError("candidate contributor root identity cannot be verified", "contributor-root-drift");
	}
	const root = record.root;
	assertCandidateOwnerParent(record.commonDir, platform);
	if (!isWithin(record.parent, root) || !existsSync(root)) throw new CandidateViewError("candidate view is missing or moved");
	const rootStat = lstatSync(root);
	if (!rootStat.isDirectory() || rootStat.isSymbolicLink() || realpathSync(root) !== root) throw new CandidateViewError("candidate view root is unsafe");
	for (const directory of candidateDirectories(root, record.entries)) {
		const metadata = lstatSync(directory);
		if (!metadata.isDirectory() || metadata.isSymbolicLink() || (metadata.mode & 0o222) !== 0) throw new CandidateViewError("candidate view directory is unsafe or writable");
	}
	const gitFile = lstatSync(join(root, ".git"));
	if (!gitFile.isFile() || gitFile.isSymbolicLink() || (gitFile.mode & 0o222) !== 0) throw new CandidateViewError("candidate worktree metadata is unsafe or writable");
	if (gitPathTokens(root, ["ls-files", "--others", "--exclude-standard", "-z"], record.gitExecutor).length !== 0) throw new CandidateViewError("candidate view contains injected untracked entries");
	const tree = git(root, ["write-tree"], process.env, record.gitExecutor);
	if (tree !== record.candidateTree) throw new CandidateViewError("candidate view index no longer matches its frozen tree");
	for (const gitlink of record.gitlinks) {
		if (!isSafeCandidatePath(gitlink.path) || gitlink.mode !== "160000" || !isCanonicalObjectId(gitlink.objectId)) throw new CandidateViewError("candidate view gitlink metadata is unsafe");
		if (lstatSync(join(root, gitlink.path), { throwIfNoEntry: false })) throw new CandidateViewError("candidate view contains materialized gitlink contents");
	}
	for (const entry of record.entries) {
		if (!isSafeCandidatePath(entry.path)) throw new CandidateViewError("candidate view entry path is unsafe");
		const path = join(root, entry.path);
		if (!isWithin(root, path)) throw new CandidateViewError("candidate view entry is missing or moved");
		const item = lstatSync(path, { throwIfNoEntry: false });
		if (!item) throw new CandidateViewError("candidate view entry is missing or moved");
		if (entry.mode === "120000") {
			if (!item.isSymbolicLink()) throw new CandidateViewError("candidate view symlink is unsafe or changed");
		} else if (!item.isFile() || item.isSymbolicLink() || (item.mode & 0o222) !== 0 || !hasExpectedExecutableBits(item.mode, entry.mode, platform)) {
			throw new CandidateViewError("candidate view entry is unsafe, writable, or has a changed mode");
		}
		const actualHash = entryContentHash(root, entry);
		if (actualHash !== entry.contentHash) throw new CandidateViewError("candidate view content no longer matches its frozen tree");
	}
}

