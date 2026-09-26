import { chmodSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { basename, dirname, join } from "node:path";
import { assertManagedStorePathV1, resolveRepositoryAuthorityV1 } from "./review-repository.ts";

// Pi 持有、克隆局部（Git common dir）的闩锁，记录“现在就运行评审？”
// 这个一次性问题已向该克隆的用户提出过。设计决策 #2
// （organic-rdd-parity）：作用域、方向与非对称性精确镜像 gentle-ai 自己
// 的 RDDConsentAsked/RecordRDDConsentAsked（按克隆、仅接受、永不提交、
// 永不继承）——但这是 Pi 自己的闩锁，在 Pi 自己的路径上，绝不是
// gentle-ai 私有的 rdd-mode/asked.json。写入其他产品的私有权威存储
// 将是边界违规。
export const REVIEW_CONSENT_LATCH_SCHEMA = "gentle-pi.review-consent-asked/v1";
const REVIEW_CONSENT_LATCH_PAYLOAD = `{"schema":"${REVIEW_CONSENT_LATCH_SCHEMA}"}\n`;

function reviewConsentLatchPath(cwd: string): string {
	const authority = resolveRepositoryAuthorityV1(cwd);
	return assertManagedStorePathV1(authority.common_directory, join(authority.common_directory, "gentle-pi", "review-consent", "asked.json"));
}

/**
 * 读取该克隆是否已问过一次性同意问题。从未记录过闩锁时返回 false。
 * 当仓库/Git common dir 权威完全无法解析（不可解析、非 Git 或浅仓库）
 * 时抛错——调用方必须按威胁矩阵将其视为“不写闩锁，评审继续”，
 * 而不是静默报告存在闩锁。
 */
export function readReviewConsentLatch(cwd: string): boolean {
	const path = reviewConsentLatchPath(cwd);
	let payload: string;
	try {
		payload = readFileSync(path, "utf8");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
		throw error;
	}
	return payload === REVIEW_CONSENT_LATCH_PAYLOAD;
}

/**
 * 为该克隆记录一次性同意问题已被提出。单向：只在接受时调用，
 * 拒绝时绝不调用。幂等——记录两次写入的是完全相同的权威字节。
 */
export function recordReviewConsentLatch(cwd: string): void {
	const path = reviewConsentLatchPath(cwd);
	mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
	// 与本层普遍纪律一致：临时文件 + rename 原子替换，崩溃窗口内绝不
	// 留下半写状态（读取是严格全等比较，空文件只会引发重复询问）。
	const staging = join(dirname(path), `.${basename(path)}.tmp-${randomUUID()}`);
	writeFileSync(staging, REVIEW_CONSENT_LATCH_PAYLOAD, { mode: 0o600 });
	try {
		renameSync(staging, path);
	} catch (error) {
		rmSync(staging, { force: true });
		throw error;
	}
	chmodSync(path, 0o600);
}
