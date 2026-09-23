// 候选视图注册表：CandidateViewRegistry——登记/查询/清理候选视图与权威评审状态。
// 自 lib/review-candidate-view.ts 拆分（机械平移，语义零改动）。

import {
	realpathSync
} from "node:fs";
import {
	resolve
} from "node:path";
import {
	removeCandidateOwner,
	sweepCandidateOwners
} from "./review-candidate-view-owner.ts";
import {
	assertManifestMatchesGit,
	type AuthoritativeReviewingCandidateState,
	type BindCandidateViewRequest,
	type CandidateGitExecutor,
	candidateRecordsShareIdentity,
	type CandidateView,
	CandidateViewError,
	type CandidateViewRecord,
	type CreateCandidateViewRequest,
	defaultCandidateGitExecutor,
	deriveChangedPathManifest,
	deriveChangedScope,
	type FrozenCandidateProjection,
	git,
	gitlinkMapsEqual,
	isFullCommitId,
	isSafeCandidatePath,
	isWithin,
	makeWritableForCleanup,
	type NativeCandidateProjectionDescriptor,
	parseTree,
	resolveCandidateBase,
	resolveCandidateBaseTree,
	REVIEW_LENS,
	type ReviewLens
} from "./review-candidate-view-git.ts";
import {
	assertRecordSafe,
	materializeCandidateView
} from "./review-candidate-view-materialize.ts";
export class CandidateViewRegistry {
	private readonly records = new Map<string, CandidateViewRecord>();
	private readonly gitExecutor: CandidateGitExecutor;
	private readonly platform: NodeJS.Platform;
	constructor(gitExecutor: CandidateGitExecutor = defaultCandidateGitExecutor, platform: NodeJS.Platform = process.platform) {
		this.gitExecutor = gitExecutor;
		this.platform = platform;
	}
	// 生命周期状态既按提供方 lineage 划分作用域，也按权威
	// 目标工作树划分。lineage 文本是仓库局部的，同一
	// Pi 会话拥有的两个仓库中合法地可能相同。
	private readonly lineages = new Map<string, string>();
	private readonly projections = new Map<string, FrozenCandidateProjection>();
	private readonly replays = new Map<string, string>();
	private readonly current = new Map<string, { lineageId: string; token: string }>();
	// 最后一次被尝试且失败的派发绑定水合。被
	// 吞掉的水合失败本身就是缺陷（现场报告 2026-08-16）：
	// 没有它，后来的派发拒绝会声称从未有过可用绑定，
	// 而不是点名该次尝试及其类型化原因。
	private readonly lastHydrationFailures = new Map<string, { lineageId: string; reason: string; message: string }>();

	private canonicalRoot(contributorRoot: string): string {
		try {
			return realpathSync(contributorRoot);
		} catch {
			throw new CandidateViewError("candidate contributor root could not be resolved", "contributor-root-unresolvable");
		}
	}

	private lineageKey(contributorRoot: string, lineageId: string): string {
		return `${this.canonicalRoot(contributorRoot)}\u0000${lineageId}`;
	}

	private replayKey(contributorRoot: string, replayKey: string): string {
		return `${this.canonicalRoot(contributorRoot)}\u0000${replayKey}`;
	}

	private uniqueKey(
		entries: ReadonlyMap<string, unknown>,
		lineageId: string,
		contributorRoot: string | undefined,
	): string | undefined {
		if (contributorRoot !== undefined) {
			const key = this.lineageKey(contributorRoot, lineageId);
			return entries.has(key) ? key : undefined;
		}
		const suffix = `\u0000${lineageId}`;
		const matches = [...entries.keys()].filter((key) => key.endsWith(suffix));
		if (matches.length === 0) return undefined;
		if (matches.length !== 1) {
			throw new CandidateViewError(`candidate lifecycle lineage ${lineageId} is ambiguous across target roots; pass an explicit workspaceRoot`, "lineage-root-ambiguous");
		}
		return matches[0]!;
	}

	private requireKey(
		entries: ReadonlyMap<string, unknown>,
		lineageId: string,
		contributorRoot: string | undefined,
		missing: string,
	): string {
		return this.uniqueKey(entries, lineageId, contributorRoot)
			?? (() => { throw new CandidateViewError(missing); })();
	}

	/**
	 * 返回绑定到某条 lineage 的唯一活跃目标根，或 undefined。
	 * 该 lineage 绑定到多个根时抛出；调用方必须传入
	 * 显式的 workspaceRoot 来消解歧义。
	 */
	resolveWorkspaceRoot(lineageId: string): string | undefined {
		const key = this.uniqueKey(this.lineages, lineageId, undefined);
		return key === undefined ? undefined : key.slice(0, key.lastIndexOf("\u0000"));
	}

	assertWorkspaceRoot(lineageId: string, contributorRoot: string): void {
		const root = this.canonicalRoot(contributorRoot);
		const exactKey = this.lineageKey(root, lineageId);
		if (this.lineages.has(exactKey)) {
			this.assertLineageRootIdentity(lineageId, root);
			return;
		}
		const bound = this.resolveWorkspaceRoot(lineageId);
		if (bound !== undefined) {
			throw new CandidateViewError(`candidate lifecycle lineage ${lineageId} is bound to ${bound}, not the requested workspaceRoot ${root}`, "lineage-root-drift");
		}
	}

	private assertLineageRootIdentity(lineageId: string, contributorRoot: string): void {
		const key = this.lineageKey(contributorRoot, lineageId);
		const token = this.lineages.get(key);
		const record = token === undefined ? undefined : this.records.get(token);
		if (record !== undefined) assertRecordSafe(record, this.platform);
	}

	create(request: CreateCandidateViewRequest): CandidateView {
		return this.createOrReuse(request);
	}

	sweepOrphans(contributorRoot: string): void {
		try {
			const cwd = realpathSync(contributorRoot);
			const common = realpathSync(resolve(cwd, git(cwd, ["rev-parse", "--git-common-dir"], process.env, this.gitExecutor)));
			sweepCandidateOwners(common, (args) => git(common, args, process.env, this.gitExecutor), makeWritableForCleanup, this.platform);
		} catch { /* 非仓库与不可用的所有权保持原样。 */ }
	}

	cleanupAll(): void {
		for (const token of [...this.records.keys()]) {
			try { this.cleanup(token); } catch { /* 继续处理其他自有视图；失败的记录仍可重试。 */ }
		}
	}

	createOrReuse(request: CreateCandidateViewRequest): CandidateView {
		const contributorRoot = this.canonicalRoot(request.contributorRoot);
		const normalizedRequest = { ...request, contributorRoot };
		const scopedReplayKey = normalizedRequest.replayKey === undefined ? undefined : this.replayKey(contributorRoot, normalizedRequest.replayKey);
		const token = scopedReplayKey === undefined ? undefined : this.replays.get(scopedReplayKey);
		const existing = token === undefined ? undefined : this.records.get(token);
		if (existing) { assertRecordSafe(existing, this.platform); return this.expose(existing); }
		const record = materializeCandidateView(normalizedRequest, this.gitExecutor, this.platform);
		this.records.set(record.token, record);
		if (scopedReplayKey !== undefined) this.replays.set(scopedReplayKey, record.token);
		return this.expose(record);
	}

	bind(request: BindCandidateViewRequest): void {
		this.bindCurrent(request);
	}

	bindCurrent(request: BindCandidateViewRequest): void {
		const selectedLenses = this.validateSelectedLenses(request.selectedLenses);
		const candidate = this.records.get(request.token);
		const key = candidate === undefined ? undefined : this.lineageKey(candidate.contributorRoot, request.lineageId);
		const existingToken = key === undefined ? undefined : this.lineages.get(key);
		// 为本控制器已绑定的 lineage 重试原生
		// START（原生报告为 "resumed"）时，会在到达这里之前
		// 重新物化出一个内容相同的新候选视图（新
		// 令牌）。把该重复视图重新绑定到同一 lineage 键过去会
		// 以 "candidate view lineage binding is missing or ambiguous"
		// 保守失败，尽管实际并无歧义：这是完全相同的
		// 可评审内容，且已由 Git 重新验证。改为丢弃冗余的
		// 重复视图并保持已绑定视图为当前视图，而不是让
		// 重试失败（gentle-pi candidate-view 重绑缺陷，
		// ga#4085 / ga#4050）。
		if (candidate !== undefined && existingToken !== undefined && existingToken !== request.token) {
			const existing = this.records.get(existingToken);
			let existingSafe = false;
			if (existing !== undefined && existing.lineageId === request.lineageId) {
				try { assertRecordSafe(existing, this.platform); existingSafe = true; } catch { existingSafe = false; }
			}
			if (existing !== undefined && existingSafe && candidateRecordsShareIdentity(existing, candidate)) {
				existing.selectedLenses = selectedLenses;
				this.remove(candidate);
				this.forget(candidate);
				this.current.set(existing.contributorRoot, { lineageId: request.lineageId, token: existingToken });
				return;
			}
		}
		const record = this.bindRecord(request.token, request.lineageId, selectedLenses);
		this.current.set(record.contributorRoot, { lineageId: request.lineageId, token: request.token });
	}

	retain(token: string, lineageId: string): void {
		const record = this.bindRecord(token, lineageId, []);
		this.current.set(record.contributorRoot, { lineageId, token });
	}

	restoreCurrentFromNativeStart(request: BindCandidateViewRequest): void {
		const record = this.records.get(request.token);
		if (!record || record.lineageId !== undefined) throw new CandidateViewError("native reviewing candidate view is missing or already bound", "authoritative-current-match-missing");
		if (this.current.has(record.contributorRoot)) throw new CandidateViewError("candidate view already has a current lineage binding", "current-binding-already-established");
		assertRecordSafe(record, this.platform);
		this.assertCurrentBindingMatchesLiveCandidate(record);
		this.bindCurrent(request);
	}

	hasCurrentBinding(contributorRoot?: string): boolean {
		return contributorRoot === undefined ? this.current.size > 0 : this.current.has(this.canonicalRoot(contributorRoot));
	}

	restoreCurrentFromAuthoritativeReviewingStates(
		contributorRoot: string,
		states: readonly AuthoritativeReviewingCandidateState[],
	): void {
		const root = this.canonicalRoot(contributorRoot);
		if (this.current.has(root)) throw new CandidateViewError("candidate view already has a current lineage binding", "current-binding-already-established");
		if (states.length === 0) throw new CandidateViewError("no authoritative reviewing lineage exactly matches the live candidate", "authoritative-current-match-missing");
		if (states.length !== 1) throw new CandidateViewError("multiple authoritative reviewing lineages exactly match the live candidate", "authoritative-current-match-ambiguous");
		const live = materializeCandidateView({ contributorRoot: root, baseRef: states[0]!.baseCommit, committedOnly: states[0]!.committedOnly === true, ...(states[0]!.intendedUntracked === undefined ? {} : { intendedUntracked: states[0]!.intendedUntracked }) }, this.gitExecutor, this.platform);
		try {
			const matches = states.filter((state) => this.matchesAuthoritativeState(live, state));
			if (matches.length === 0) throw new CandidateViewError("no authoritative reviewing lineage exactly matches the live candidate", "authoritative-current-match-missing");
			if (matches.length !== 1) throw new CandidateViewError("multiple authoritative reviewing lineages exactly match the live candidate", "authoritative-current-match-ambiguous");
			const state = matches[0]!;
			const selectedLenses = this.validateSelectedLenses(state.selectedLenses);
			this.records.set(live.token, live);
			this.bindRecord(live.token, state.lineageId, selectedLenses);
			this.current.set(root, { lineageId: state.lineageId, token: live.token });
		} catch (error) {
			this.records.delete(live.token);
			this.remove(live);
			throw error;
		}
	}

	createCorrected(lineageId: string, contributorRoot: string, replayKey: string): CandidateView {
		const root = this.canonicalRoot(contributorRoot);
		const projection = this.resolveProjection(lineageId, root);
		const scopedReplayKey = this.replayKey(root, replayKey);
		const existingToken = this.replays.get(scopedReplayKey);
		const existing = existingToken === undefined ? undefined : this.records.get(existingToken);
		if (existing) {
			if (existing.lineageId !== undefined) throw new CandidateViewError("corrected candidate replay is no longer pending");
			assertRecordSafe(existing, this.platform);
			return this.expose(existing);
		}
		const record = materializeCandidateView({ contributorRoot: root, baseRef: projection.baseCommit, committedOnly: projection.committedOnly, ...(projection.intendedUntracked === undefined ? {} : { intendedUntracked: projection.intendedUntracked }) }, this.gitExecutor, this.platform);
		try {
			if (record.baseCommit !== projection.baseCommit || record.baseTree !== projection.baseTree) throw new CandidateViewError("corrected candidate base does not match the frozen genesis base");
			if (!record.scope.paths.every((path) => projection.paths.includes(path))) throw new CandidateViewError("corrected candidate scope escapes the frozen genesis paths");
			this.records.set(record.token, record);
			this.replays.set(scopedReplayKey, record.token);
			return this.expose(record);
		} catch (error) {
			this.remove(record);
			throw error;
		}
	}

	promoteCorrected(lineageId: string, token: string, contributorRoot?: string): void {
		const replacement = this.records.get(token);
		const root = contributorRoot === undefined ? replacement?.contributorRoot : this.canonicalRoot(contributorRoot);
		const key = root === undefined ? undefined : this.uniqueKey(this.projections, lineageId, root);
		const projection = key === undefined ? undefined : this.projections.get(key);
		const currentToken = key === undefined ? undefined : this.lineages.get(key);
		const current = currentToken === undefined ? undefined : this.records.get(currentToken);
		if (!replacement || replacement.lineageId !== undefined || !key || !projection || (currentToken !== undefined && (!current || current.lineageId !== lineageId))) {
			throw new CandidateViewError("corrected candidate replacement is missing or ambiguous");
		}
		const currentBinding = this.current.get(root);
		if (currentBinding !== undefined && currentBinding.lineageId !== lineageId) {
			throw new CandidateViewError("corrected candidate replacement conflicts with the current lineage binding");
		}
		assertRecordSafe(replacement, this.platform);
		if (current) assertRecordSafe(current, this.platform);
		if (
			replacement.contributorRoot !== projection.contributorRoot ||
			replacement.baseCommit !== projection.baseCommit ||
			replacement.baseTree !== projection.baseTree ||
			replacement.committedOnly !== projection.committedOnly ||
			JSON.stringify(replacement.intendedUntracked ?? null) !== JSON.stringify(projection.intendedUntracked ?? null) ||
			!replacement.scope.paths.every((path) => projection.paths.includes(path))
		) {
			throw new CandidateViewError("corrected candidate replacement does not preserve its frozen lineage projection");
		}
		replacement.lineageId = lineageId;
		replacement.selectedLenses = [];
		this.lineages.set(key, token);
		for (const [pendingKey, pendingToken] of this.replays) if (pendingToken === token) this.replays.delete(pendingKey);
		this.projections.set(key, {
			contributorRoot: replacement.contributorRoot,
			baseCommit: replacement.baseCommit,
			baseTree: replacement.baseTree,
			candidateTree: replacement.candidateTree,
			committedOnly: replacement.committedOnly,
			intendedUntracked: replacement.intendedUntracked,
			paths: replacement.scope.paths,
			modes: replacement.scope.modes,
			gitlinks: replacement.scope.gitlinks,
			deletedPaths: replacement.scope.deletedPaths,
		});
		this.current.set(root, { lineageId, token });
		if (current) {
			this.remove(current);
			this.forget(current);
		}
	}

	private validateSelectedLenses(lenses: readonly string[]): ReviewLens[] {
		const selectedLenses = lenses.filter((lens): lens is ReviewLens => (REVIEW_LENS as readonly string[]).includes(lens));
		if (selectedLenses.length !== lenses.length || selectedLenses.length === 0) throw new CandidateViewError("candidate view has no valid selected review lenses");
		return selectedLenses;
	}

	private matchesAuthoritativeState(record: CandidateViewRecord, state: AuthoritativeReviewingCandidateState): boolean {
		try {
			return realpathSync(state.contributorRoot) === record.contributorRoot &&
				state.baseCommit === record.baseCommit &&
				state.baseTree === record.baseTree &&
				state.candidateTree === record.candidateTree &&
				(state.committedOnly ?? false) === record.committedOnly &&
				(state.intendedUntracked === undefined || JSON.stringify(state.intendedUntracked) === JSON.stringify(record.intendedUntracked)) &&
				JSON.stringify(state.paths) === JSON.stringify(record.scope.paths) &&
				JSON.stringify(state.modes) === JSON.stringify(record.scope.modes) &&
				gitlinkMapsEqual(state.gitlinks ?? {}, record.scope.gitlinks) &&
				JSON.stringify(state.deletedPaths) === JSON.stringify(record.scope.deletedPaths);
		} catch {
			return false;
		}
	}

	private bindRecord(token: string, lineageId: string, selectedLenses: readonly ReviewLens[]): CandidateViewRecord {
		const record = this.records.get(token);
		const key = record === undefined ? undefined : this.lineageKey(record.contributorRoot, lineageId);
		if (!record || record.lineageId !== undefined || !key || this.lineages.has(key)) throw new CandidateViewError("candidate view lineage binding is missing or ambiguous");
		assertRecordSafe(record, this.platform);
		record.lineageId = lineageId;
		record.selectedLenses = selectedLenses;
		this.lineages.set(key, record.token);
		this.projections.set(key, {
			contributorRoot: record.contributorRoot,
			baseCommit: record.baseCommit,
			baseTree: record.baseTree,
			candidateTree: record.candidateTree,
			committedOnly: record.committedOnly,
			intendedUntracked: record.intendedUntracked,
			paths: record.scope.paths,
			modes: record.scope.modes,
			gitlinks: record.scope.gitlinks,
			deletedPaths: record.scope.deletedPaths,
		});
		for (const [replayKey, pendingToken] of this.replays) if (pendingToken === token) this.replays.delete(replayKey);
		return record;
	}

	hasProjection(lineageId: string, contributorRoot?: string): boolean {
		return this.uniqueKey(this.projections, lineageId, contributorRoot) !== undefined;
	}

	restoreProjection(lineageId: string, contributorRoot: string, baseCommit: string, baseTree: string, candidateTree: string, paths: readonly string[]): void {
		const root = this.canonicalRoot(contributorRoot);
		const key = this.lineageKey(root, lineageId);
		const base = resolveCandidateBase(root, baseCommit, process.env, this.gitExecutor);
		if (!lineageId || this.projections.has(key) || base.commit !== baseCommit || base.tree !== baseTree || !isFullCommitId(candidateTree) || paths.some((path) => !isSafeCandidatePath(path)) || new Set(paths).size !== paths.length) throw new CandidateViewError("frozen correction projection is invalid or already restored");
		this.projections.set(key, { contributorRoot: root, baseCommit, baseTree, candidateTree, committedOnly: false, paths: [...paths], modes: {}, gitlinks: {}, deletedPaths: [] });
	}

	restoreProjectionFromNative(lineageId: string, contributorRoot: string, descriptor: NativeCandidateProjectionDescriptor): void {
		const root = this.canonicalRoot(contributorRoot);
		const key = this.lineageKey(root, lineageId);
		if (!lineageId || this.projections.has(key) || !isFullCommitId(descriptor.baseTree) || !isFullCommitId(descriptor.currentCandidateTree)) throw new CandidateViewError("native frozen projection is invalid or already restored");
		if (descriptor.paths.some((path) => !isSafeCandidatePath(path)) || new Set(descriptor.paths).size !== descriptor.paths.length) throw new CandidateViewError("native frozen projection paths are invalid");
		if (descriptor.intendedUntracked.some((path) => !descriptor.paths.includes(path)) || new Set(descriptor.intendedUntracked).size !== descriptor.intendedUntracked.length) throw new CandidateViewError("native intended-untracked projection is invalid");
		const head = resolveCandidateBase(root, "HEAD", process.env, this.gitExecutor);
		const base = head.tree === descriptor.baseTree ? head : resolveCandidateBaseTree(root, descriptor.baseTree, this.gitExecutor);
		const committedOnly = head.tree === descriptor.currentCandidateTree && base.tree !== head.tree;
		if (!committedOnly && head.tree !== descriptor.baseTree) throw new CandidateViewError("native projection base no longer matches HEAD");
		// 原生 `staged` 同时覆盖已提交的 HEAD 区间与
		// HEAD 上的精确当前索引。改为从 Git 重新推导后者而不是
		// 信任标签；这也会拒绝被误标为 staged 的
		// 含脏快照。
		const stagedIndex = !committedOnly && descriptor.baseTree === head.tree &&
			git(root, ["write-tree"], process.env, this.gitExecutor) === descriptor.currentCandidateTree;
		if (
			(descriptor.projection === "staged" && !committedOnly && !stagedIndex) ||
			(descriptor.projection === "workspace" && committedOnly)
		) {
			throw new CandidateViewError("native projection commit-state does not match its declared projection kind", "projection-kind-drift");
		}
		const tree = parseTree(root, descriptor.currentCandidateTree, this.gitExecutor);
		const scope = deriveChangedScope(root, descriptor.baseTree, descriptor.currentCandidateTree, [...tree.entries, ...tree.gitlinks], this.gitExecutor);
		// manifest 是取代（SUBSUMES）排序路径比较而不是叠加在
		// 其上：它检查同一路径集外加路径集无法表达的
		// 模式、状态与类型状态，并点名其中哪一项
		// 漂移了。没有 manifest 的描述符保持旧检查。
		if (descriptor.manifest !== undefined) {
			assertManifestMatchesGit(descriptor, deriveChangedPathManifest(root, descriptor.baseTree, descriptor.currentCandidateTree, this.gitExecutor));
		} else if (JSON.stringify(scope.paths) !== JSON.stringify([...descriptor.paths].sort())) {
			throw new CandidateViewError("native projection paths do not match Git content");
		}
		this.projections.set(key, {
			contributorRoot: root,
			baseCommit: base.commit,
			baseTree: descriptor.baseTree,
			candidateTree: descriptor.currentCandidateTree,
			committedOnly,
			intendedUntracked: Object.freeze([...descriptor.intendedUntracked]),
			paths: scope.paths,
			modes: scope.modes,
			gitlinks: scope.gitlinks,
			deletedPaths: scope.deletedPaths,
		});
	}

	/**
	 * 从提供方自己的投影重新推导该 lineage 的 FINALIZE 绑定，
	 * 替换本会话仍持有的绑定。
	 *
	 * 现场缺陷（Engram #12547）：一旦有界修正被准入，
	 * 候选身份合法地移动，提供方为修正后的
	 * 目标发出 finalize 转换。启动评审的
	 * 会话仍持有 START 时的不可变评审器视图，因此把它
	 * 与修正后的投影比较会被读作漂移，永远铸造不出
	 * 回执 —— 而从原生描述符恢复的新进程
	 * 能成功完成同一条 lineage 的 finalize。这里让会话内
	 * 路径表现得像那条已修正的新进程路径。
	 *
	 * 这是重新推导，不是放宽：替换物由
	 * Git 物化且必须与提供方描述符精确一致
	 * （基线树、投影种类、变更路径 manifest），调用方之后
	 * 仍会断言绑定。不可变评审器视图在此被有意退役 ——
	 * 消费它的各评审视角已在修正之前
	 * 完成。
	 */
	rebindForFinalizeFromNative(lineageId: string, contributorRoot: string, descriptor: NativeCandidateProjectionDescriptor): CandidateView {
		return this.restoreForFinalizeFromNative(lineageId, contributorRoot, descriptor);
	}

	/**
	 * 恢复某条 lineage 的 FINALIZE 绑定（gentle-pi #185）：过期条目
	 * 只是被分离，不被销毁，因此失败的恢复可以撤销它。
	 */
	restoreForFinalizeFromNative(lineageId: string, contributorRoot: string, descriptor: NativeCandidateProjectionDescriptor): CandidateView {
		const root = this.canonicalRoot(contributorRoot);
		const key = this.lineageKey(root, lineageId);
		const staleToken = this.lineages.get(key), staleProjection = this.projections.get(key);
		this.lineages.delete(key); this.projections.delete(key);
		let projectionRestored = false;
		let record: CandidateViewRecord | undefined;
		try {
			this.restoreProjectionFromNative(lineageId, root, descriptor);
			projectionRestored = true;
			const projection = this.resolveProjection(lineageId, root);
			const matchesProjection = (candidate: CandidateViewRecord): boolean => candidate.baseTree === projection.baseTree && candidate.candidateTree === projection.candidateTree && JSON.stringify(candidate.scope.paths) === JSON.stringify(projection.paths);
			const emptyIntendedUntracked = projection.intendedUntracked?.length === 0;
			record = materializeCandidateView({ contributorRoot: root, baseRef: projection.baseCommit, committedOnly: projection.committedOnly, ...(!emptyIntendedUntracked && projection.intendedUntracked !== undefined ? { intendedUntracked: projection.intendedUntracked } : {}) }, this.gitExecutor, this.platform);
			if (!matchesProjection(record) && emptyIntendedUntracked) {
				this.remove(record);
				record = undefined;
				record = materializeCandidateView({ contributorRoot: root, baseRef: projection.baseCommit, committedOnly: projection.committedOnly, intendedUntracked: [] }, this.gitExecutor, this.platform);
			}
			if (!matchesProjection(record)) throw new CandidateViewError("live candidate does not match the native frozen projection");
			this.records.set(record.token, record);
			this.bindRecord(record.token, lineageId, []);
			const stale = staleToken === undefined ? undefined : this.records.get(staleToken);
			if (stale !== undefined) { this.remove(stale); this.forget(stale); }
			return this.expose(record);
		} catch (error) {
			if (projectionRestored) this.projections.delete(key);
			if (record !== undefined) {
				this.forget(record);
				this.remove(record);
			}
			if (staleToken !== undefined) this.lineages.set(key, staleToken);
			if (staleProjection !== undefined) this.projections.set(key, staleProjection);
			throw error;
		}
	}

	/**
	 * 为本控制器从未启动过的 lineage 镜像 START 时的
	 * 派发注册（现场缺陷 2026-08-16：由原生
	 * `review recover` 创建的后继只存在于原生权威中）。权威
	 * 的 STATUS 描述符提供冻结投影；先重新物化
	 * 存活候选并要求其精确匹配，然后才用提供方命名的
	 * 待定评审视角建立面向派发的当前绑定。
	 */
	restoreCurrentForDispatchFromNative(lineageId: string, contributorRoot: string, descriptor: NativeCandidateProjectionDescriptor, selectedLenses: readonly string[]): void {
		const root = this.canonicalRoot(contributorRoot);
		const key = this.lineageKey(root, lineageId);
		if (this.current.has(root)) throw new CandidateViewError("candidate view already has a current lineage binding", "current-binding-already-established");
		let projectionRestored = false;
		let record: CandidateViewRecord | undefined;
		try {
			const lenses = this.validateSelectedLenses(selectedLenses);
			this.restoreProjectionFromNative(lineageId, root, descriptor);
			projectionRestored = true;
			const projection = this.resolveProjection(lineageId, root);
			record = materializeCandidateView({ contributorRoot: root, baseRef: projection.baseCommit, committedOnly: projection.committedOnly, ...(projection.intendedUntracked === undefined ? {} : { intendedUntracked: projection.intendedUntracked }) }, this.gitExecutor, this.platform);
			if (record.baseTree !== projection.baseTree || record.candidateTree !== projection.candidateTree || JSON.stringify(record.scope.paths) !== JSON.stringify(projection.paths)) {
				throw new CandidateViewError("live candidate does not match the native frozen projection");
			}
			this.records.set(record.token, record);
			this.bindRecord(record.token, lineageId, lenses);
			this.current.set(root, { lineageId, token: record.token });
			this.lastHydrationFailures.delete(root);
		} catch (error) {
			if (projectionRestored) this.projections.delete(key);
			if (record !== undefined) {
				this.forget(record);
				this.remove(record);
			}
			this.lastHydrationFailures.set(root, {
				lineageId,
				reason: error instanceof CandidateViewError ? error.reason : "candidate-view-invalid",
				message: error instanceof Error ? error.message : String(error),
			});
			throw error;
		}
	}

	resolveProjection(lineageId: string, contributorRoot: string): FrozenCandidateProjection {
		const key = this.lineageKey(contributorRoot, lineageId);
		const projection = this.projections.get(key);
		if (!projection) throw new CandidateViewError("candidate projection is missing, ambiguous, or belongs to a different contributor root");
		this.assertLineageRootIdentity(lineageId, contributorRoot);
		return projection;
	}

	resolveForLens(lineageId: string, lens: string, contributorRoot?: string): CandidateView {
		const key = this.requireKey(this.lineages, lineageId, contributorRoot, "candidate view context is missing, ambiguous, stale, or lens-unselected");
		const token = this.lineages.get(key);
		const record = token === undefined ? undefined : this.records.get(token);
		if (!record || record.lineageId !== lineageId || !record.selectedLenses?.includes(lens as ReviewLens)) throw new CandidateViewError("candidate view context is missing, ambiguous, stale, or lens-unselected");
		assertRecordSafe(record, this.platform);
		return this.expose(record);
	}

	private currentBinding(contributorRoot?: string): { root: string; lineageId: string; token: string } {
		if (contributorRoot !== undefined) {
			const root = this.canonicalRoot(contributorRoot);
			const binding = this.current.get(root);
			if (binding !== undefined) return { root, ...binding };
			const failure = this.lastHydrationFailures.get(root);
			if (failure !== undefined) {
				throw new CandidateViewError(
					`review subagent dispatch has no current controller-owned candidate view lineage binding: hydration for lineage ${failure.lineageId} was attempted from authoritative native status and failed (${failure.reason}): ${failure.message}`,
					"current-binding-hydration-failed",
				);
			}
			throw new CandidateViewError("review subagent dispatch has no current controller-owned candidate view lineage binding", "current-binding-missing");
		}
		if (this.current.size !== 1) {
			if (this.current.size > 1) throw new CandidateViewError("review subagent dispatch has multiple current lineage bindings across target roots; pass an explicit workspaceRoot", "current-binding-root-ambiguous");
			const failure = [...this.lastHydrationFailures.values()][0];
			if (failure !== undefined) {
				throw new CandidateViewError(
					`review subagent dispatch has no current controller-owned candidate view lineage binding: hydration for lineage ${failure.lineageId} was attempted from authoritative native status and failed (${failure.reason}): ${failure.message}`,
					"current-binding-hydration-failed",
				);
			}
			throw new CandidateViewError("review subagent dispatch has no current controller-owned candidate view lineage binding", "current-binding-missing");
		}
		const [root, binding] = this.current.entries().next().value as [string, { lineageId: string; token: string }];
		return { root, ...binding };
	}

	currentLineageId(contributorRoot?: string): string {
		return this.currentBinding(contributorRoot).lineageId;
	}

	/** 最后一次失败的派发绑定水合，供控制器封套使用。 */
	lastDispatchHydrationFailure(contributorRoot?: string): Readonly<{ lineageId: string; reason: string; message: string }> | undefined {
		if (contributorRoot !== undefined) return this.lastHydrationFailures.get(this.canonicalRoot(contributorRoot));
		return this.lastHydrationFailures.size === 1 ? [...this.lastHydrationFailures.values()][0] : undefined;
	}

	resolveCurrentForLens(lens: string, contributorRoot?: string): CandidateView {
		return this.resolveCurrentForLenses([lens], contributorRoot)[0]!;
	}

	resolveCurrentForLenses(lenses: readonly string[], contributorRoot?: string): CandidateView[] {
		const current = this.currentBinding(contributorRoot);
		const record = this.records.get(current.token);
		if (!record || record.lineageId !== current.lineageId || this.lineages.get(this.lineageKey(current.root, current.lineageId)) !== current.token) throw new CandidateViewError("review subagent dispatch current lineage binding is stale or ambiguous", "current-binding-stale");
		assertRecordSafe(record, this.platform);
		this.assertCurrentBindingMatchesLiveCandidate(record);
		if (!lenses.every((lens) => record.selectedLenses?.includes(lens as ReviewLens))) throw new CandidateViewError("candidate view context is missing, ambiguous, stale, or lens-unselected", "current-binding-lens-unselected");
		return lenses.map(() => this.expose(record));
	}

	private assertCurrentBindingMatchesLiveCandidate(record: CandidateViewRecord): void {
		const live = materializeCandidateView({ contributorRoot: record.contributorRoot, baseRef: record.baseCommit, committedOnly: record.committedOnly, ...(record.intendedUntracked === undefined ? {} : { intendedUntracked: record.intendedUntracked }) }, this.gitExecutor, this.platform);
		try {
			if (
				live.baseCommit !== record.baseCommit ||
				live.baseTree !== record.baseTree ||
				live.candidateTree !== record.candidateTree ||
				live.committedOnly !== record.committedOnly ||
				JSON.stringify(live.scope.paths) !== JSON.stringify(record.scope.paths) ||
				JSON.stringify(live.scope.modes) !== JSON.stringify(record.scope.modes) ||
				!gitlinkMapsEqual(live.scope.gitlinks, record.scope.gitlinks) ||
				JSON.stringify(live.scope.deletedPaths) !== JSON.stringify(record.scope.deletedPaths)
			) throw new CandidateViewError("live candidate no longer matches the current controller-owned lineage binding", "current-binding-live-candidate-drift");
		} finally {
			this.remove(live);
		}
	}

	resolveForFinalize(lineageId: string, contributorRoot?: string): CandidateView {
		const key = this.requireKey(this.lineages, lineageId, contributorRoot, "candidate view context is missing or ambiguous for FINALIZE");
		const token = this.lineages.get(key);
		const record = token === undefined ? undefined : this.records.get(token);
		if (!record || record.lineageId !== lineageId) throw new CandidateViewError("candidate view context is missing or ambiguous for FINALIZE");
		assertRecordSafe(record, this.platform);
		return this.expose(record);
	}

	cleanup(token: string): void {
		const record = this.records.get(token);
		if (!record) return;
		this.remove(record);
		this.forget(record);
	}

	cleanupTerminal(lineageId: string, state: string, contributorRoot?: string): void {
		if (state !== "approved" && state !== "escalated") return;
		const key = this.uniqueKey(this.lineages, lineageId, contributorRoot);
		const token = key === undefined ? undefined : this.lineages.get(key);
		if (token) this.cleanup(token);
		if (state === "escalated" && key !== undefined) this.projections.delete(key);
	}

	private remove(record: CandidateViewRecord): void {
		if (!isWithin(record.parent, record.root)) throw new CandidateViewError("candidate view cleanup escaped its owned parent");
		removeCandidateOwner(record.owner, (args) => git(record.commonDir, args, process.env, record.gitExecutor), makeWritableForCleanup, false, this.platform);
	}

	private forget(record: CandidateViewRecord): void {
		this.records.delete(record.token);
		if (record.lineageId) {
			const key = this.lineageKey(record.contributorRoot, record.lineageId);
			if (this.lineages.get(key) === record.token) this.lineages.delete(key);
		}
		if (this.current.get(record.contributorRoot)?.token === record.token) this.current.delete(record.contributorRoot);
		for (const [replayKey, pendingToken] of this.replays) if (pendingToken === record.token) this.replays.delete(replayKey);
	}

	consumeProjection(lineageId: string, contributorRoot?: string): void {
		const key = this.uniqueKey(this.projections, lineageId, contributorRoot);
		if (key !== undefined) this.projections.delete(key);
	}

	private expose(record: CandidateViewRecord): CandidateView {
		return {
			token: record.token,
			root: record.root,
			contributorRoot: record.contributorRoot,
			baseCommit: record.baseCommit,
			baseTree: record.baseTree,
			candidateTree: record.candidateTree,
			committedOnly: record.committedOnly,
			intendedUntracked: record.intendedUntracked,
			paths: record.scope.paths,
			modes: record.scope.modes,
			gitlinks: record.scope.gitlinks,
			deletedPaths: record.scope.deletedPaths,
			verify: () => assertRecordSafe(record, this.platform),
			cleanup: () => this.cleanup(record.token),
		};
	}
}

