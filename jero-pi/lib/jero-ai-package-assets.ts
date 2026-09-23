// 包资产审计：安装/陈旧/覆盖计数与 doctor 诊断行。纯只读检查，绝不写盘。
// 自 extensions/jero-ai.ts 拆分（机械平移，语义零改动）。

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveGentlePiAgentHome } from "./agent-home.ts";
import { getPackageAssetOwner, hasPackageAssetOwnerInstallation, type PackageAssetOwner, isPackageManagedSddAsset } from "./sdd-preflight.ts";

import { discoverableNonBuiltinAgentRoots, listAgentsFromDir, updateFrontmatterRouting } from "./jero-ai-model-config.ts";

export const GRAPH_V1_ORDINARY_READ_ONLY = "Graph-v1 ordinary review authority is read-only; use native compact-v2 review operations";

export const PACKAGE_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

export const ASSETS_DIR = join(PACKAGE_ROOT, "assets");



export function gentlePiAgentHome(): string {
	return resolveGentlePiAgentHome();
}



export function packageAssetAudit(owner: PackageAssetOwner): { stale: number; overrides: number } {
	let stale = 0;
	let overrides = 0;
	for (const [assetSubdir, installedSubdir, ownershipPrefix] of [
		["agents", "agents", "agents"],
		["chains", "chains", "chains"],
		["support", join("jero", "support"), "jero/support"],
	] as const) {
		const assetDir = join(ASSETS_DIR, assetSubdir);
		if (!existsSync(assetDir)) continue;
		for (const entry of readdirSync(assetDir, { withFileTypes: true })) {
			if (!entry.isFile() || getPackageAssetOwner(`${ownershipPrefix}/${entry.name}`) !== owner) continue;
			const installedPath = join(gentlePiAgentHome(), installedSubdir, entry.name);
			try {
				if (!existsSync(installedPath)) {
					stale += 1;
					continue;
				}
				if (
					!isPackageManagedSddAsset(
						installedPath,
						`${ownershipPrefix}/${entry.name}`,
					)
				) {
					overrides += 1;
					continue;
				}
				const packaged = readFileSync(join(assetDir, entry.name), "utf8");
				const installed = readFileSync(installedPath, "utf8");
				const comparablePackaged =
					assetSubdir === "agents"
						? updateFrontmatterRouting(packaged, undefined)
						: packaged;
				const comparableInstalled =
					assetSubdir === "agents"
						? updateFrontmatterRouting(installed, undefined)
						: installed;
				if (comparablePackaged !== comparableInstalled) {
					stale += 1;
				}
			} catch {
				stale += 1;
			}
		}
	}
	return { stale, overrides };
}



export function packageAssetDiagnosticLines(cwd: string): string[] {
	return (["delegation", "review", "sdd"] as const).flatMap((owner) => {
		const label = owner === "sdd" ? "SDD" : owner;
		const onDemand = owner === "sdd" && !hasPackageAssetOwnerInstallation(owner);
		const { stale, overrides } = packageAssetAudit(owner);
		const local = localAgentOverrideCount(cwd, owner);
		const lines = [onDemand
			? `info: Global ${label} assets: on demand (not installed)`
			: `${stale > 0 ? "warn" : "pass"}: Global ${label} assets stale: ${stale} file(s)`];
		if (!onDemand && stale > 0) {
			lines[0] += ` — run /jero:install-${owner} --force to refresh managed assets`;
		}
		if (overrides > 0) {
			lines.push(`info: Global ${label} user overrides: ${overrides} file(s); preserved, not package drift`);
		}
		if (local > 0) {
			lines.push(`warn: Active ${label} agent overrides: ${local} file(s) — active non-builtin ${label} agents shadow package assets; keep only intentional overrides`);
		}
		return lines;
	});
}



function localAgentOverrideCount(cwd: string, owner: PackageAssetOwner): number {
	const packageSddAgentsDir = join(ASSETS_DIR, "agents");
	const packageSddAgentNames = new Set(
		listAgentsFromDir(packageSddAgentsDir, "builtin")
			.filter((agent) =>
				getPackageAssetOwner(
					`agents/${relative(packageSddAgentsDir, agent.filePath).split(sep).join("/")}`,
				) === owner,
			)
			.map((agent) => agent.name),
	);
	let count = 0;
	for (const { dir, source, packageManaged } of discoverableNonBuiltinAgentRoots(cwd)) {
		if (packageManaged || !existsSync(dir)) continue;
		for (const agent of listAgentsFromDir(dir, source)) {
			if (packageSddAgentNames.has(agent.name)) count += 1;
		}
	}
	return count;
}

// ---------------------------------------------------------------------------
// 后台子代理策略 —— 项目 > 全局 > 环境变量 > 默认关闭
// ---------------------------------------------------------------------------

