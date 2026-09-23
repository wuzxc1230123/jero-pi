// SDD 资产安装：受管资产清单与锁、遗留迁移、原子替换、目录复制与安装入口。
// 自 lib/sdd-preflight.ts 拆分（机械平移，语义零改动）。

import { createHash, randomUUID } from "node:crypto";
import {
	existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, unlinkSync,
	writeFileSync
} from "node:fs";
import { dirname, isAbsolute, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveGentlePiAgentHome } from "./agent-home.ts";
import {
	isRecord, type LegacyManagedAssetsManifest, type ManagedAssetsLockOwner,
	type ManagedAssetsManifest, type PackageAssetInstallLockOptions
} from "./sdd-preflight-preferences.ts";
const PACKAGE_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const ASSETS_DIR = join(PACKAGE_ROOT, "assets");
const MANAGED_ASSETS_MANIFEST = "managed-assets.json";
const MANAGED_ASSETS_LOCK = "managed-assets.lock";
const MANAGED_ASSETS_SCHEMA_VERSION = 1;
const MANAGED_ASSETS_LOCK_TIMEOUT_MS = 5_000;
const MANAGED_ASSETS_LOCK_RETRY_MS = 25;
const LEGACY_MANAGED_ASSET_MANIFESTS = Object.freeze([
	{ path: join(ASSETS_DIR, "migrations", "managed-assets-v0.10.7.json"), version: "0.10.7" },
	{ path: join(ASSETS_DIR, "migrations", "managed-assets-v0.13.json"), version: "0.13.0" },
	{ path: join(ASSETS_DIR, "migrations", "managed-assets-v0.14.json"), version: "0.14.0" },
	{ path: join(ASSETS_DIR, "migrations", "managed-assets-v2.5.0.json"), version: "2.5.0" },
	{ path: join(ASSETS_DIR, "migrations", "managed-assets-jero-0.1.0.json"), version: "0.1.0" },
]);

const ASSET_OWNER_BY_KEY = Object.freeze({
	"agents/jero-explore.md": "delegation",
	"agents/jero-verify.md": "delegation",
	"agents/jero-worker.md": "delegation",
	"agents/jd-fix-agent.md": "review",
	"agents/jd-judge-a.md": "review",
	"agents/jd-judge-b.md": "review",
	"agents/review-readability.md": "review",
	"agents/review-reliability.md": "review",
	"agents/review-resilience.md": "review",
	"agents/review-risk.md": "review",
	"agents/review-refuter.md": "review",
	"agents/review-validator.md": "review",
	"chains/4r-review.chain.md": "review",
	"agents/sdd-apply.md": "sdd",
	"agents/sdd-archive.md": "sdd",
	"agents/sdd-design.md": "sdd",
	"agents/sdd-explore.md": "sdd",
	"agents/sdd-init.md": "sdd",
	"agents/sdd-onboard.md": "sdd",
	"agents/sdd-proposal.md": "sdd",
	"agents/sdd-research.md": "sdd",
	"agents/sdd-remediate.md": "sdd",
	"agents/sdd-spec.md": "sdd",
	"agents/sdd-status.md": "sdd",
	"agents/sdd-sync.md": "sdd",
	"agents/sdd-tasks.md": "sdd",
	"agents/sdd-verify.md": "sdd",
	"chains/sdd-full.chain.md": "sdd",
	"chains/sdd-plan.chain.md": "sdd",
	"chains/sdd-verify.chain.md": "sdd",
	"jero/support/sdd-status-contract.md": "sdd",
	"jero/support/strict-tdd.md": "sdd",
	"jero/support/strict-tdd-verify.md": "sdd",
} as const);

export type PackageAssetOwner = (typeof ASSET_OWNER_BY_KEY)[keyof typeof ASSET_OWNER_BY_KEY];

export function getPackageAssetOwner(ownershipKey: string): PackageAssetOwner | undefined {
	return Object.hasOwn(ASSET_OWNER_BY_KEY, ownershipKey)
		? ASSET_OWNER_BY_KEY[ownershipKey as keyof typeof ASSET_OWNER_BY_KEY]
		: undefined;
}

function gentlePiAgentHome(): string {
	return resolveGentlePiAgentHome();
}


function emptyManagedAssetsManifest(): ManagedAssetsManifest {
	return {
		schemaVersion: MANAGED_ASSETS_SCHEMA_VERSION,
		assets: {},
	};
}

function readManagedAssetsManifest(path: string): ManagedAssetsManifest {
	if (!existsSync(path)) return emptyManagedAssetsManifest();
	try {
		const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
		if (
			!isRecord(parsed) ||
			parsed.schemaVersion !== MANAGED_ASSETS_SCHEMA_VERSION ||
			!isRecord(parsed.assets)
		) {
			return emptyManagedAssetsManifest();
		}
		const assets = Object.fromEntries(
			Object.entries(parsed.assets).filter(
				(entry): entry is [string, string] => typeof entry[1] === "string",
			),
		);
		return { schemaVersion: MANAGED_ASSETS_SCHEMA_VERSION, assets };
	} catch {
		return emptyManagedAssetsManifest();
	}
}

function managedAssetHash(content: string): string {
	return createHash("sha256").update(content).digest("hex");
}

function readManagedAssetsLockOwner(lockPath: string): ManagedAssetsLockOwner | undefined {
	try {
		if (!lstatSync(lockPath).isFile()) return undefined;
		const parsed: unknown = JSON.parse(readFileSync(lockPath, "utf8"));
		// typeof 守卫只负责把 unknown 收窄成 number；整数语义仍由 isInteger 把关。
		if (!isRecord(parsed) || parsed.schemaVersion !== 1 || typeof parsed.token !== "string" || parsed.token.length === 0 || typeof parsed.pid !== "number" || !Number.isInteger(parsed.pid) || parsed.pid <= 0 || typeof parsed.createdAtMs !== "number" || !Number.isFinite(parsed.createdAtMs)) return undefined;
		return parsed as unknown as ManagedAssetsLockOwner;
	} catch {
		return undefined;
	}
}

// 等待以事件循环友好的 setTimeout 实现：Atomics.wait 会同步阻塞整个
// 事件循环（TUI 冻结最长 5 秒），仅多进程并发安装资产时触发。
const sleepMs = (milliseconds: number): Promise<void> =>
	new Promise((resolve) => {
		setTimeout(resolve, milliseconds);
	});

async function waitForManagedAssetsLock(milliseconds: number): Promise<void> {
	if (milliseconds <= 0) return;
	await sleepMs(milliseconds);
}

function normalizedLockDuration(value: number | undefined, fallback: number): number {
	return typeof value === "number" && Number.isFinite(value) && value >= 0
		? Math.floor(value)
		: fallback;
}

async function acquireManagedAssetsLock(
	agentHome: string,
	options: PackageAssetInstallLockOptions = {},
): Promise<{ path: string; owner: ManagedAssetsLockOwner }> {
	const lockParent = join(agentHome, "jero");
	const lockPath = join(lockParent, MANAGED_ASSETS_LOCK);
	const timeoutMs = normalizedLockDuration(options.timeoutMs, MANAGED_ASSETS_LOCK_TIMEOUT_MS);
	const retryMs = Math.max(1, normalizedLockDuration(options.retryMs, MANAGED_ASSETS_LOCK_RETRY_MS));
	const deadline = Date.now() + timeoutMs;
	mkdirSync(lockParent, { recursive: true });
	for (;;) {
		const owner: ManagedAssetsLockOwner = {
			schemaVersion: 1,
			token: randomUUID(),
			pid: process.pid,
			createdAtMs: Date.now(),
		};
		try {
			writeFileSync(lockPath, JSON.stringify(owner), { encoding: "utf8", flag: "wx" });
			return { path: lockPath, owner };
		} catch (error) {
			if (!isRecord(error) || error.code !== "EEXIST") throw error;
			try {
				if (!lstatSync(lockPath).isFile()) {
					throw new Error(`Managed-assets lock path is unsafe and must be a regular file: ${lockPath}`);
				}
			} catch (inspectionError) {
				if (isRecord(inspectionError) && inspectionError.code === "ENOENT") continue;
				throw inspectionError;
			}
			if (Date.now() >= deadline) {
				throw new Error(`Timed out acquiring managed-assets lock file ${lockPath}. Verify no installer is active before removing this exact lock file.`);
			}
			await waitForManagedAssetsLock(retryMs);
		}
	}
}

function releaseManagedAssetsLock(lock: { path: string; owner: ManagedAssetsLockOwner }): void {
	if (readManagedAssetsLockOwner(lock.path)?.token !== lock.owner.token) return;
	try {
		unlinkSync(lock.path);
	} catch {
		// 无法读取或已被替换的锁保留下来供操作员检查。
	}
}

async function withManagedAssetsLock<T>(
	agentHome: string,
	action: () => T,
	options: PackageAssetInstallLockOptions | undefined,
): Promise<T> {
	const lock = await acquireManagedAssetsLock(agentHome, options);
	try {
		await waitForManagedAssetsLock(normalizedLockDuration(options?.holdLockMs, 0));
		return action();
	} finally {
		releaseManagedAssetsLock(lock);
	}
}

function readLegacyManagedAssets(
	path: string,
	version: string,
): LegacyManagedAssetsManifest | undefined {
	try {
		const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
		if (
			!isRecord(parsed) ||
			parsed.schemaVersion !== MANAGED_ASSETS_SCHEMA_VERSION ||
			parsed.packageVersion !== version ||
			!isRecord(parsed.assets)
		) {
			return undefined;
		}
		const assets = Object.fromEntries(
			Object.entries(parsed.assets).filter(
				(entry): entry is [string, string] => typeof entry[1] === "string",
			),
		);
		return {
			schemaVersion: MANAGED_ASSETS_SCHEMA_VERSION,
			packageVersion: version,
			assets,
		};
	} catch {
		return undefined;
	}
}

function readLegacyManagedAssetHashes(): Record<string, readonly string[]> {
	const hashes: Record<string, string[]> = {};
	for (const manifest of LEGACY_MANAGED_ASSET_MANIFESTS) {
		const assets = readLegacyManagedAssets(manifest.path, manifest.version)?.assets;
		if (!assets) continue;
		for (const [ownershipKey, hash] of Object.entries(assets)) {
			const known = hashes[ownershipKey] ?? [];
			if (!known.includes(hash)) known.push(hash);
			hashes[ownershipKey] = known;
		}
	}
	return hashes;
}

function updateAgentFrontmatterRouting(
	content: string,
	routingLines: readonly string[],
): string {
	if (!content.startsWith("---\n")) return content;
	const endIndex = content.indexOf("\n---", 4);
	if (endIndex === -1) return content;
	const frontmatter = content.slice(4, endIndex);
	const body = content.slice(endIndex);
	const lines = frontmatter
		.split("\n")
		.filter((line) => !/^(?:model|thinking):/.test(line));
	if (routingLines.length > 0) {
		const descriptionIndex = lines.findIndex((line) =>
			line.startsWith("description:"),
		);
		const insertIndex =
			descriptionIndex >= 0 ? descriptionIndex + 1 : Math.min(1, lines.length);
		lines.splice(insertIndex, 0, ...routingLines);
	}
	return `---\n${lines.join("\n")}${body}`;
}

function legacyComparableAssetContent(
	ownershipKey: string,
	content: string,
): string {
	return ownershipKey.startsWith("agents/")
		? updateAgentFrontmatterRouting(content, [])
		: content;
}

function migrateLegacyAssetContent(
	ownershipKey: string,
	installedContent: string,
	packagedContent: string,
): string {
	if (!ownershipKey.startsWith("agents/")) return packagedContent;
	if (!installedContent.startsWith("---\n")) return packagedContent;
	const endIndex = installedContent.indexOf("\n---", 4);
	if (endIndex === -1) return packagedContent;
	const routingLines = installedContent
		.slice(4, endIndex)
		.split("\n")
		.filter((line) => /^(?:model|thinking):/.test(line));
	return updateAgentFrontmatterRouting(packagedContent, routingLines);
}

function replaceManagedAssetFileAtomically(path: string, content: string): void {
	const temporaryPath = join(dirname(path), `.${randomUUID()}.tmp`);
	let mode: number | undefined;
	try {
		const stat = lstatSync(path);
		if (stat.isFile()) mode = stat.mode & 0o777;
	} catch (error) {
		if (!isRecord(error) || error.code !== "ENOENT") throw error;
	}
	try {
		writeFileSync(temporaryPath, content, {
			encoding: "utf8",
			flag: "wx",
			...(mode === undefined ? {} : { mode }),
		});
		renameSync(temporaryPath, path);
	} finally {
		try {
			unlinkSync(temporaryPath);
		} catch {
			// 已改名或因其他原因不可访问的临时文件无需进一步处理。
		}
	}
}

export async function updatePackageManagedSddAgentOwnership(
	installedPath: string,
	previousContent: string,
	nextContent: string,
	lockOptions?: PackageAssetInstallLockOptions,
): Promise<boolean> {
	const agentHome = gentlePiAgentHome();
	const relativePath = relative(join(agentHome, "agents"), installedPath);
	if (
		relativePath.length === 0 ||
		relativePath === ".." ||
		relativePath.startsWith(`..${sep}`) ||
		isAbsolute(relativePath)
	) {
		return false;
	}
	const ownershipKey = `agents/${relativePath.split(sep).join("/")}`;
	return await withManagedAssetsLock(agentHome, () => {
		const registryPath = join(agentHome, "jero", MANAGED_ASSETS_MANIFEST);
		const legacyRegistryPath = join(agentHome, "gentle-ai", MANAGED_ASSETS_MANIFEST);
		const manifestPath = existsSync(registryPath) ? registryPath : legacyRegistryPath;
		// 读取可能回落到改名前的注册表；写入总是落在 jero 位置。
		const manifest = readManagedAssetsManifest(manifestPath);
		if (manifest.assets[ownershipKey] !== managedAssetHash(previousContent)) {
			return false;
		}
		const installedContent = readFileSync(installedPath, "utf8");
		// next-content 分支保留先前的内部调用方契约：
		// 在本函数之前已写文件的调用方仍能收到受管
		// 清单更新。新调用方走下面的 previous-content 分支，使
		// 文件与清单更新共享这把锁。
		if (installedContent !== nextContent && installedContent !== previousContent) {
			return false;
		}
		try {
			if (installedContent === previousContent) {
				replaceManagedAssetFileAtomically(installedPath, nextContent);
			}
			manifest.assets[ownershipKey] = managedAssetHash(nextContent);
			replaceManagedAssetFileAtomically(
				registryPath,
				JSON.stringify(manifest, null, 2),
			);
		} catch (error) {
			try {
				replaceManagedAssetFileAtomically(installedPath, previousContent);
			} catch (rollbackError) {
				throw new Error(
					`Managed routing update failed and could not restore ${installedPath}: ${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`,
					{ cause: error },
				);
			}
			throw error;
		}
		return true;
	}, lockOptions);
}

export function hasPackageAssetOwnerInstallation(owner: PackageAssetOwner): boolean {
	const agentHome = gentlePiAgentHome();
	const manifest = readManagedAssetsManifest(join(agentHome, "jero", MANAGED_ASSETS_MANIFEST));
	return Object.keys(manifest.assets).some((key) => getPackageAssetOwner(key) === owner) ||
		Object.entries(ASSET_OWNER_BY_KEY).some(([key, candidate]) =>
			candidate === owner && existsSync(join(agentHome, key)),
		);
}

export function isPackageManagedSddAsset(
	installedPath: string,
	ownershipKey: string,
): boolean {
	const manifest = readManagedAssetsManifest(
		join(gentlePiAgentHome(), "jero", MANAGED_ASSETS_MANIFEST),
	);
	const expectedHash = manifest.assets[ownershipKey];
	if (expectedHash === undefined || !existsSync(installedPath)) return false;
	try {
		return (
			managedAssetHash(readFileSync(installedPath, "utf8")) ===
			expectedHash
		);
	} catch {
		return false;
	}
}

// ---------------------------------------------------------------------------
// 持久存储 —— 跨越重启、恢复的会话与非 SDD 角色启动而存活
// ---------------------------------------------------------------------------


function copyDirectoryFiles(
	sourceDir: string,
	targetDir: string,
	ownershipPrefix: string,
	force: boolean,
	manifest: ManagedAssetsManifest,
	legacyAssetHashes: (() => Readonly<Record<string, readonly string[]>>) | undefined,
	selected?: ReadonlySet<string>,
): { copied: number; skipped: number } {
	if (!existsSync(sourceDir)) return { copied: 0, skipped: 0 };
	if (selected && ![...selected].some(key => key.startsWith(`${ownershipPrefix}/`))) {
		return { copied: 0, skipped: 0 };
	}
	mkdirSync(targetDir, { recursive: true });
	let copied = 0;
	let skipped = 0;
	for (const entry of readdirSync(sourceDir, { withFileTypes: true })) {
		const sourcePath = join(sourceDir, entry.name);
		const targetPath = join(targetDir, entry.name);
		const ownershipKey = `${ownershipPrefix}/${entry.name}`;
		if (entry.isDirectory()) {
			const child = copyDirectoryFiles(
				sourcePath,
				targetPath,
				ownershipKey,
				force,
				manifest,
				legacyAssetHashes,
				selected,
			);
			copied += child.copied;
			skipped += child.skipped;
			continue;
		}
		if (!entry.isFile() || (selected && !selected.has(ownershipKey))) continue;
		const source = readFileSync(sourcePath, "utf8");
		let nextSource = source;
		if (existsSync(targetPath)) {
			if (!force) {
				skipped += 1;
				continue;
			}
			const managedHash = manifest.assets[ownershipKey];
			let installedContent: string | undefined;
			try {
				installedContent = readFileSync(targetPath, "utf8");
			} catch {
				installedContent = undefined;
			}
			const installedHash = installedContent === undefined
				? undefined
				: managedAssetHash(installedContent);
			if (managedHash === undefined) {
				const legacyHashes = legacyAssetHashes?.()[ownershipKey];
				const comparableLegacyHash = installedContent === undefined
					? undefined
					: managedAssetHash(
							legacyComparableAssetContent(ownershipKey, installedContent),
						);
				if (
					legacyHashes === undefined ||
					comparableLegacyHash === undefined ||
					!legacyHashes.includes(comparableLegacyHash)
				) {
					delete manifest.assets[ownershipKey];
					skipped += 1;
					continue;
				}
				nextSource = migrateLegacyAssetContent(
					ownershipKey,
					installedContent,
					source,
				);
			} else if (installedHash !== managedHash) {
				delete manifest.assets[ownershipKey];
				skipped += 1;
				continue;
			} else if (ownershipKey === "agents/sdd-research.md" && installedContent !== undefined) {
				// 在后续刷新时保留旧迁移所采纳的路由。
				nextSource = migrateLegacyAssetContent(ownershipKey, installedContent, source);
			}
		}
		writeFileSync(targetPath, nextSource);
		manifest.assets[ownershipKey] = managedAssetHash(nextSource);
		copied += 1;
	}
	return { copied, skipped };
}

// 由 gentle-pi#311 P5 退役的资产：Pi 拥有的对抗性评审角色。
// refuter 与 validator 的裁决现在经由提供方渲染的自包含向量
// 通过 Go 拥有的 pi 进程执行，因此这些角色
// 定义已没有运行时消费者。assets/migrations 下的迁移
// 清单是只追加的旧哈希历史（强制安装的
// 采纳证据），没有删除语义，因此历史保持原样，
// 退役在这里发生：已安装副本只有在其内容哈希证明
// 包所有权（当前清单或旧历史）时才被删除；
// 用户修改过的副本原样保留，只是失去受管所有权。
const RETIRED_MANAGED_ASSETS = Object.freeze([
	"agents/review-refuter.md",
	"agents/review-validator.md",
]);

// P5b：改名进入 jero 命名空间的资产。历史清单保持
// 原样（只追加的采纳证据）；已安装的旧名副本
// 只有在其哈希证明包所有权时才被移除，与退役
// 完全一致 —— 新名文件随后经正常拷贝安装。
const RENAMED_MANAGED_ASSETS = Object.freeze({
	"agents/gentle-ai-explore.md": "agents/jero-explore.md",
	"agents/gentle-ai-verify.md": "agents/jero-verify.md",
	"agents/gentle-ai-worker.md": "agents/jero-worker.md",
	"gentle-ai/support/sdd-status-contract.md": "jero/support/sdd-status-contract.md",
	"gentle-ai/support/strict-tdd.md": "jero/support/strict-tdd.md",
	"gentle-ai/support/strict-tdd-verify.md": "jero/support/strict-tdd-verify.md",
});

function migrateRenamedManagedAssets(
	agentHome: string,
	manifest: ManagedAssetsManifest,
	selected: ReadonlySet<string> | undefined,
): void {
	let legacyHashes: Record<string, readonly string[]> | undefined;
	for (const [oldKey, newKey] of Object.entries(RENAMED_MANAGED_ASSETS)) {
		if (selected && !selected.has(newKey) && !selected.has(oldKey)) continue;
		const installedPath = join(agentHome, ...oldKey.split("/"));
		if (!existsSync(installedPath)) {
			delete manifest.assets[oldKey];
			continue;
		}
		let installedContent: string | undefined;
		try {
			installedContent = readFileSync(installedPath, "utf8");
		} catch {
			installedContent = undefined;
		}
		if (installedContent === undefined) continue;
		const installedHash = managedAssetHash(installedContent);
		const managed = manifest.assets[oldKey] === installedHash;
		const legacy = (legacyHashes ??= readLegacyManagedAssetHashes())[oldKey]?.includes(installedHash) === true;
		if (managed || legacy) {
			try {
				rmSync(installedPath);
			} catch {
				continue;
			}
		}
		delete manifest.assets[oldKey];
	}
}
function removeRetiredManagedAssets(
	agentHome: string,
	manifest: ManagedAssetsManifest,
	selected?: ReadonlySet<string>,
): void {
	let legacyHashes: Record<string, readonly string[]> | undefined;
	for (const ownershipKey of RETIRED_MANAGED_ASSETS) {
		if (selected && !selected.has(ownershipKey)) continue;
		const installedPath = join(agentHome, ...ownershipKey.split("/"));
		if (!existsSync(installedPath)) {
			delete manifest.assets[ownershipKey];
			continue;
		}
		let installedContent: string | undefined;
		try {
			installedContent = readFileSync(installedPath, "utf8");
		} catch {
			installedContent = undefined;
		}
		if (installedContent === undefined) continue;
		const installedHash = managedAssetHash(installedContent);
		const managed = manifest.assets[ownershipKey] === installedHash;
		const legacy = (legacyHashes ??= readLegacyManagedAssetHashes())[ownershipKey]?.includes(
			managedAssetHash(legacyComparableAssetContent(ownershipKey, installedContent)),
		) === true;
		if (managed || legacy) {
			try {
				rmSync(installedPath);
			} catch {
				continue;
			}
		}
		// 受管副本已移除；用户修改过的副本保留，
		// 但无论哪种情况都不再是包管理的。
		delete manifest.assets[ownershipKey];
	}
}

// 为兼容保留的旧全所有者入口。
// 按所有者的命令与 SDD 预检直接使用 installPackageAssets。
export async function installSddAssets(
	cwd: string,
	force: boolean,
): Promise<{ agents: number; chains: number; support: number; skipped: number }> {
	return installPackageAssets(cwd, force);
}

export async function installPackageAssets(
	_cwd: string,
	force: boolean,
	owners?: readonly PackageAssetOwner[],
	lockOptions?: PackageAssetInstallLockOptions,
): Promise<{ agents: number; chains: number; support: number; skipped: number }> {
	const agentHome = gentlePiAgentHome();
	return withManagedAssetsLock(agentHome, () => {
		const selected = owners === undefined ? undefined : new Set(
			Object.entries(ASSET_OWNER_BY_KEY).filter(([, owner]) => owners.includes(owner)).map(([key]) => key),
		);
		const registryPath = join(agentHome, "jero", MANAGED_ASSETS_MANIFEST);
		const legacyRegistryPath = join(agentHome, "gentle-ai", MANAGED_ASSETS_MANIFEST);
		const manifestPath = existsSync(registryPath) ? registryPath : legacyRegistryPath;
		// 读取可能回落到改名前的注册表；写入总是落在 jero 位置。
		let legacyAssetHashes: (() => Readonly<Record<string, readonly string[]>>) | undefined;
		if (force) {
			let cachedLegacyAssetHashes: Record<string, readonly string[]> | undefined;
			legacyAssetHashes = () =>
				(cachedLegacyAssetHashes ??= readLegacyManagedAssetHashes());
		}
		const manifest = readManagedAssetsManifest(manifestPath);
		removeRetiredManagedAssets(agentHome, manifest, selected);
		migrateRenamedManagedAssets(agentHome, manifest, selected);
		const agents = copyDirectoryFiles(
			join(ASSETS_DIR, "agents"),
			join(agentHome, "agents"),
			"agents",
			force,
			manifest,
			legacyAssetHashes,
			selected,
		);
		const chains = copyDirectoryFiles(
			join(ASSETS_DIR, "chains"),
			join(agentHome, "chains"),
			"chains",
			force,
			manifest,
			legacyAssetHashes,
			selected,
		);
		const support = copyDirectoryFiles(
			join(ASSETS_DIR, "support"),
			join(agentHome, "jero", "support"),
			"jero/support",
			force,
			manifest,
			legacyAssetHashes,
			selected,
		);
		mkdirSync(dirname(registryPath), { recursive: true });
		writeFileSync(registryPath, JSON.stringify(manifest, null, 2));
		return {
			agents: agents.copied,
			chains: chains.copied,
			support: support.copied,
			skipped: agents.skipped + chains.skipped + support.skipped,
		};
	}, lockOptions);
}

