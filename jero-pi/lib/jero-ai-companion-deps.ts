// 伴生依赖健康审计：doctor 诊断行。对应 dependency-exit-plan.md 的"钉精确
// 版本 + 出事按表行动"纪律——本检查只回答两件事：每个伴生依赖是否仍按钉
// 版安装在本包旁、pi 清单里承接它的扩展入口是否仍解析得到。纯只读，绝不
// 写盘；缺失=安装破损（fail），版本漂移或入口失效=供应链信号（warn），
// 按 exit plan 的该依赖行行动，绝不临场发明处置。

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { PACKAGE_ROOT } from "./jero-ai-paths.ts";

export interface CompanionDependencyStatus {
	name: string;
	/** package.json dependencies 里的原始版本规格。 */
	pinned: string;
	/** 规格是否精确钉版（无 ^/~/> 等前缀）——仓库纪律是全精确钉。 */
	exactPinned: boolean;
	/** node_modules/<dep>/package.json 的 version；缺失为 undefined。 */
	installedVersion?: string;
	/** pi.extensions 中以 node_modules/<dep>/ 开头的入口（相对包根）。 */
	manifestEntries: string[];
	/** 全部入口文件是否存在于包根下。无入口即为 false。 */
	entriesResolve: boolean;
}

interface MinimalPackageJson {
	dependencies?: Record<string, string>;
	pi?: { extensions?: string[] };
}

function readPackageJson(packageRoot: string): MinimalPackageJson {
	return JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8")) as MinimalPackageJson;
}

export function readCompanionDependencyStatuses(packageRoot: string): CompanionDependencyStatus[] {
	const manifest = readPackageJson(packageRoot);
	const entries = manifest.pi?.extensions ?? [];
	return Object.entries(manifest.dependencies ?? {}).map(([name, pinned]) => {
		const manifestEntries = entries.filter((entry) => entry.startsWith(`node_modules/${name}/`));
		let installedVersion: string | undefined;
		try {
			const installed = JSON.parse(
				readFileSync(join(packageRoot, "node_modules", name, "package.json"), "utf8"),
			) as { version?: unknown };
			if (typeof installed.version === "string") installedVersion = installed.version;
		} catch { /* 缺失即未安装，保留 undefined。 */ }
		return {
			name,
			pinned,
			exactPinned: /^\d/.test(pinned),
			installedVersion,
			manifestEntries,
			entriesResolve: manifestEntries.length > 0 &&
				manifestEntries.every((entry) => existsSync(join(packageRoot, entry))),
		};
	});
}

export function companionDependencyDiagnosticLines(packageRoot: string = PACKAGE_ROOT): string[] {
	const statuses = readCompanionDependencyStatuses(packageRoot);
	const lines: string[] = [];
	let healthy = 0;
	for (const status of statuses) {
		if (status.installedVersion === undefined) {
			lines.push(
				`fail: Companion ${status.name} not installed (pinned ${status.pinned}) — broken install; reinstall jero-pi, then see docs/dependency-exit-plan.md`,
			);
			continue;
		}
		if (!status.entriesResolve) {
			lines.push(
				`warn: Companion ${status.name}@${status.installedVersion} pi manifest entry missing or unresolved (${status.manifestEntries.length} entry(ies)) — check docs/dependency-exit-plan.md for this dependency`,
			);
			continue;
		}
		if (!status.exactPinned) {
			lines.push(`info: Companion ${status.name}@${status.installedVersion} pinned "${status.pinned}" is not exact — repo policy pins exact versions`);
			healthy += 1;
			continue;
		}
		if (status.installedVersion !== status.pinned) {
			lines.push(
				`warn: Companion ${status.name} version drift: pinned ${status.pinned}, installed ${status.installedVersion} — audit the change before accepting it (docs/dependency-exit-plan.md)`,
			);
			continue;
		}
		healthy += 1;
	}
	const summary = statuses.length === 0
		? "warn: Companion dependencies absent from package.json — expected exactly the exit-plan set"
		: healthy === statuses.length
			? `pass: Companion dependencies ${healthy}/${statuses.length} healthy (exact-pinned, installed, pi entries resolve)`
			: `warn: Companion dependencies ${healthy}/${statuses.length} healthy — see lines above`;
	return [...lines, summary];
}
