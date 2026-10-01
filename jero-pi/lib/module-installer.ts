// 包内模块库安装器——模块安装的受支持入口（/jero:install-module 的域逻辑）。
//
// 包内 assets/modules/ 就是注册表：每个 {token}/ 目录是一份可安装的模块束
// （module.json（v2，dependencies 自述）+ knowledge/ + references/ + 可选
// agents/ 与 skills/）。安装器做闭包解析（依赖先装、环与缺失响亮报错）。
// 安装目标全部在项目内：模块本体 → .pi/modules/{token}/，agents/*.md →
// .pi/agents/，skills/{name}/ → .pi/skills/{name}/——模块不做全局安装，
// 全局生效与"项目即边界"的契约冲突。
//
// 幂等与用户改动保护：安装记录 .pi/module-installs.json 记录每个模块的
// 版本与全部落盘文件哈希；已装同版本跳过（--force 重装），记录外的文件
// 或哈希漂移视为用户改动——跳过并指名，绝不静默覆盖（哲学与受管资产的
// managed-assets.json 一致）。

import { createHash } from "node:crypto";
import {
	existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { parseModuleManifest, type McpServerSpec, type ModuleManifest } from "./module-contract.ts";
import { ASSETS_DIR } from "./jero-ai-paths.ts";
import { resolveJeroPiAgentHome } from "./agent-home.ts";

export const MODULE_INSTALLS_REL_PATH = join(".pi", "module-installs.json");
export const MODULE_INSTALLS_SCHEMA = "jero.module-installs/v1";

/** 包内模块库根（assets/modules）——安装器与 /jero:module-list 的注册表来源。 */
export function bundleModulesRoot(): string {
	return join(ASSETS_DIR, "modules");
}

export interface BundleModule {
	readonly token: string;
	readonly version: string;
	readonly description?: string;
	readonly dependencies: readonly string[];
	readonly manifest: ModuleManifest;
	/** 包内模块束目录（绝对路径）。 */
	readonly dir: string;
}

export interface BrokenBundle {
	readonly dirName: string;
	readonly issues: readonly { readonly code: string; readonly message: string }[];
}

export interface DiscoverBundlesResult {
	readonly bundles: readonly BundleModule[];
	readonly broken: readonly BrokenBundle[];
}

/** 发现包内模块库的全部模块束；无 module.json 的目录不是模块束（静默跳过）。 */
export function discoverBundles(modulesRoot: string): DiscoverBundlesResult {
	const bundles: BundleModule[] = [];
	const broken: BrokenBundle[] = [];
	let entries;
	try {
		entries = readdirSync(modulesRoot, { withFileTypes: true });
	} catch {
		return { bundles, broken };
	}
	for (const entry of entries) {
		if (!entry.isDirectory()) continue;
		let raw: string;
		try {
			raw = readFileSync(join(modulesRoot, entry.name, "module.json"), "utf8");
		} catch {
			continue;
		}
		const parsed = parseModuleManifest(raw);
		if (parsed.manifest === undefined) {
			broken.push({
				dirName: entry.name,
				issues: parsed.issues.map((item) => ({ code: item.code, message: `${item.path}: ${item.message}` })),
			});
			continue;
		}
		bundles.push({
			token: parsed.manifest.token,
			version: parsed.manifest.version,
			description: parsed.manifest.description,
			dependencies: [...parsed.manifest.dependencies ?? []],
			manifest: parsed.manifest,
			dir: join(modulesRoot, entry.name),
		});
	}
	return { bundles, broken };
}

export interface InstallPlanStep {
	readonly token: string;
	readonly version: string;
	/** 已装同版本（调用方非 force 时跳过）。 */
	readonly alreadyInstalled: boolean;
}

export type InstallPlan =
	| { readonly ok: true; readonly steps: readonly InstallPlanStep[] }
	| { readonly ok: false; readonly reason: "unknown-token" | "missing-dependency" | "dependency-cycle"; readonly detail: string };

/**
 * 依赖闭包解析：深度优先后序（依赖先装），菱形依赖去重；未知词元、
 * 缺依赖、成环都以响亮明细失败——静默拆依赖等于运行时知识链断裂。
 */
export function resolveInstallPlan(
	bundles: readonly BundleModule[],
	requested: readonly string[],
	installedVersions: ReadonlyMap<string, string>,
): InstallPlan {
	const byToken = new Map(bundles.map((bundle) => [bundle.token, bundle]));
	const steps: InstallPlanStep[] = [];
	const planned = new Set<string>();
	const visit = (token: string, chain: string[]): InstallPlan | undefined => {
		if (chain.includes(token)) {
			const cycle = [...chain.slice(chain.indexOf(token)), token];
			return { ok: false, reason: "dependency-cycle", detail: `依赖成环：${cycle.join(" → ")}——请修正相关模块的 dependencies 声明` };
		}
		const bundle = byToken.get(token);
		if (bundle === undefined) {
			if (chain.length === 0) {
				return {
					ok: false,
					reason: "unknown-token",
					detail: `未知模块词元：${token}（可装：${[...byToken.keys()].sort().join("、") || "（库为空）"}，用 /jero:module-list 查看）`,
				};
			}
			return {
				ok: false,
				reason: "missing-dependency",
				detail: `依赖缺失：${chain[chain.length - 1]} 依赖 ${token}，包内模块库没有该模块（链路：${[...chain, token].join(" → ")}）`,
			};
		}
		const nextChain = [...chain, token];
		for (const dep of bundle.dependencies) {
			const error = visit(dep, nextChain);
			if (error !== undefined) return error;
		}
		if (!planned.has(token)) {
			planned.add(token);
			steps.push({ token, version: bundle.version, alreadyInstalled: installedVersions.get(token) === bundle.version });
		}
		return undefined;
	};
	for (const token of requested) {
		const error = visit(token, []);
		if (error !== undefined) return error;
	}
	return { ok: true, steps };
}

export interface ModuleInstallRecord {
	readonly version: string;
	readonly files: readonly { readonly path: string; readonly hash: string }[];
}

export interface ModuleInstallsFile {
	readonly schema: string;
	readonly modules: Readonly<Record<string, ModuleInstallRecord>>;
}

function emptyInstalls(): ModuleInstallsFile {
	return { schema: MODULE_INSTALLS_SCHEMA, modules: {} };
}

/** 读安装记录；缺失/损坏按空记录处理（用户改动保护退化为 force 语义，/jero:module-list 会显影目录无记录态）。 */
export function readModuleInstalls(projectRoot: string): ModuleInstallsFile {
	try {
		const parsed: unknown = JSON.parse(readFileSync(join(projectRoot, MODULE_INSTALLS_REL_PATH), "utf8"));
		if (
			typeof parsed === "object" && parsed !== null &&
			(parsed as { schema?: unknown }).schema === MODULE_INSTALLS_SCHEMA &&
			typeof (parsed as { modules?: unknown }).modules === "object"
		) {
			return parsed as ModuleInstallsFile;
		}
	} catch {
		// 缺失/损坏：按空记录处理，重装即重建记录。
	}
	return emptyInstalls();
}

export function writeModuleInstalls(projectRoot: string, installs: ModuleInstallsFile): void {
	const target = join(projectRoot, MODULE_INSTALLS_REL_PATH);
	mkdirSync(dirname(target), { recursive: true });
	const temp = `${target}.jero-tmp`;
	writeFileSync(temp, `${JSON.stringify(installs, null, "\t")}\n`, "utf8");
	renameSync(temp, target);
}

// —— MCP 档合并：模块声明的 MCP 服务器写入 Pi 的 agent mcp.json ——

/** Pi agent mcp.json 路径（JERO_PI_AGENT_HOME / PI_CODING_AGENT_DIR / ~/.pi/agent，与 banner 同源）。 */
export function agentMcpJsonPath(env: NodeJS.ProcessEnv = process.env): string {
	return join(resolveJeroPiAgentHome(env), "mcp.json");
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function mcpServerEntry(server: McpServerSpec): Record<string, unknown> {
	const entry: Record<string, unknown> = { command: server.command };
	if (server.args !== undefined) entry.args = [...server.args];
	if (server.env !== undefined) entry.env = { ...server.env };
	return entry;
}

/**
 * 把模块声明的 MCP 服务器档合并进 Pi 的 agent mcp.json（mcpServers 键）。
 * 用户资产保护三律：同名且内容一致 = 幂等跳过；同名但内容不同 = 保留
 * 用户档不改（drift 显影）；文件存在但不可解析 = 一律不动（保命）。
 * 用户已有的其他 server 与顶层键原样保留，原子写回。声明≠安装工具链：
 * command 的可用性由 /jero:doctor 显影，安装器不做网络安装。
 */
export function mergeModuleMcpServers(
	mcpJsonPath: string,
	servers: readonly McpServerSpec[],
): string[] {
	if (servers.length === 0) return [];
	let root: Record<string, unknown> | undefined;
	let existing: Record<string, unknown> | undefined;
	if (existsSync(mcpJsonPath)) {
		try {
			const parsed: unknown = JSON.parse(readFileSync(mcpJsonPath, "utf8"));
			if (isPlainRecord(parsed)) {
				root = parsed;
				if (isPlainRecord(parsed.mcpServers)) existing = parsed.mcpServers;
			}
		} catch {
			// 不可解析：保命不动（下方显影）。
		}
	}
	if (existsSync(mcpJsonPath) && existing === undefined) {
		return servers.map((server) =>
			`MCP 档 ${server.name} 未写入：${mcpJsonPath} 已存在但不是可解析的 mcpServers 配置——不覆盖用户文件，请手动并入`,
		);
	}
	root ??= {};
	existing ??= {};
	const lines: string[] = [];
	let changed = false;
	for (const server of servers) {
		const entry = mcpServerEntry(server);
		const current = existing[server.name];
		if (current === undefined) {
			existing[server.name] = entry;
			changed = true;
			lines.push(`MCP 档 ${server.name} 已并入 ${mcpJsonPath}（command: ${server.command}）——重载会话后生效`);
		} else if (JSON.stringify(current) === JSON.stringify(entry)) {
			lines.push(`MCP 档 ${server.name} 已存在且一致，跳过`);
		} else {
			lines.push(`MCP 档 ${server.name} 同名但内容不同——保留用户配置未覆盖（模块声明 command: ${server.command}）`);
		}
	}
	if (changed) {
		root.mcpServers = existing;
		writeFileAtomic(mcpJsonPath, `${JSON.stringify(root, null, "\t")}\n`);
	}
	return lines;
}

/** 安装明细尾追加 MCP 合并结果（模块未声明 mcp 时为空串）。 */
function mcpMergeDetail(options: InstallBundleOptions, bundle: BundleModule): string {
	const servers = bundle.manifest.mcp?.servers ?? [];
	if (servers.length === 0) return "";
	const lines = mergeModuleMcpServers(options.agentMcpJson ?? agentMcpJsonPath(), servers);
	return lines.length > 0 ? `；${lines.join("；")}` : "";
}

// —— 模块束文件布局与目标映射 ——

interface BundleFileEntry {
	/** 束内相对路径（正斜杠）。 */
	readonly bundleRel: string;
	readonly abs: string;
}

function walkFiles(dir: string, prefix: string): BundleFileEntry[] {
	const out: BundleFileEntry[] = [];
	let entries;
	try {
		entries = readdirSync(dir, { withFileTypes: true });
	} catch {
		return out;
	}
	for (const entry of entries) {
		const rel = prefix.length === 0 ? entry.name : `${prefix}/${entry.name}`;
		const abs = join(dir, entry.name);
		if (entry.isDirectory()) out.push(...walkFiles(abs, rel));
		else if (entry.isFile()) out.push({ bundleRel: rel, abs });
	}
	return out;
}

/** 束内文件 → 项目内目标路径。agents/ 与 skills/ 是安装时的伴生资产面，其余为模块本体。 */
export function bundleTargetPath(projectRoot: string, token: string, bundleRel: string): string {
	const parts = bundleRel.split("/");
	if (parts[0] === "agents") return join(projectRoot, ".pi", "agents", ...parts.slice(1));
	if (parts[0] === "skills") return join(projectRoot, ".pi", "skills", ...parts.slice(1));
	return join(projectRoot, ".pi", "modules", token, ...parts);
}

function toPosix(path: string): string {
	return path.replaceAll("\\", "/");
}

function hashContent(content: string): string {
	return createHash("sha256").update(content, "utf8").digest("hex");
}

function writeFileAtomic(dest: string, content: string): void {
	mkdirSync(dirname(dest), { recursive: true });
	const temp = `${dest}.jero-tmp`;
	writeFileSync(temp, content, "utf8");
	renameSync(temp, dest);
}

export interface InstallBundleOptions {
	/** 覆盖用户改动与同版本跳过，强制重装。 */
	readonly force?: boolean;
	/** 预读的安装记录（缺省自读；测试注入用）。 */
	readonly installs?: ModuleInstallsFile;
	/** MCP 档合并目标（缺省解析 Pi agent home 的 mcp.json；测试注入用）。 */
	readonly agentMcpJson?: string;
}

export type BundleInstallOutcome =
	| { readonly kind: "installed"; readonly token: string; readonly detail: string }
	| { readonly kind: "skipped-up-to-date"; readonly token: string; readonly detail: string }
	| { readonly kind: "skipped-user-modified"; readonly token: string; readonly detail: string }
	| { readonly kind: "skipped-unmanaged"; readonly token: string; readonly detail: string };

// 现有落盘文件与安装记录比对：记录外文件或哈希漂移 = 用户改动，指名返回。
function userModifiedDetail(
	existing: readonly { readonly projectRel: string; readonly hash: string }[],
	record: ModuleInstallRecord,
): string | undefined {
	const recorded = new Map(record.files.map((file) => [file.path, file.hash]));
	const offenses: string[] = [];
	for (const file of existing) {
		const expected = recorded.get(file.projectRel);
		if (expected === undefined) offenses.push(`${file.projectRel}（记录外新增）`);
		else if (expected !== file.hash) offenses.push(`${file.projectRel}（内容已改动）`);
	}
	if (offenses.length === 0) return undefined;
	return offenses.slice(0, 3).join("、") + (offenses.length > 3 ? ` 等 ${offenses.length} 处` : "");
}

/**
 * 安装单个模块束到项目内。目录级原子性：先清旧模块目录，再逐文件
 * 临时写 + rename；安装记录随装随写。任何跳过都带指名明细，绝不静默。
 */
export function installBundle(
	projectRoot: string,
	bundle: BundleModule,
	options: InstallBundleOptions = {},
): BundleInstallOutcome {
	const files = walkFiles(bundle.dir, "");
	// projectRel 由目标路径反解（与 bundleTargetPath 同一映射，避免双源漂移）。
	const planned = files.map((file) => {
		const target = bundleTargetPath(projectRoot, bundle.token, file.bundleRel);
		return { entry: file, target, projectRel: toPosix(target.slice(projectRoot.length + 1)) };
	});

	const installs = options.installs ?? readModuleInstalls(projectRoot);
	const record = installs.modules[bundle.token];
	const moduleDir = join(projectRoot, ".pi", "modules", bundle.token);

	// 现有落盘面：模块目录全量 + 束内点名的 agents/skills 目标。
	const existing: { projectRel: string; hash: string }[] = [];
	if (existsSync(moduleDir)) {
		for (const file of walkFiles(moduleDir, "")) {
			existing.push({ projectRel: toPosix(`.pi/modules/${bundle.token}/${file.bundleRel}`), hash: hashContent(readFileSync(file.abs, "utf8")) });
		}
	}
	for (const item of planned) {
		if (item.entry.bundleRel.startsWith("agents/") || item.entry.bundleRel.startsWith("skills/")) {
			if (existsSync(item.target) && statSync(item.target).isFile()) {
				existing.push({ projectRel: item.projectRel, hash: hashContent(readFileSync(item.target, "utf8")) });
			}
		}
	}

	if (!options.force) {
		if (existing.length > 0 && record === undefined) {
			return {
				kind: "skipped-unmanaged",
				token: bundle.token,
				detail: `.pi/ 内已有 ${bundle.token} 的文件但无安装记录（手工/创建器安装）——不接管不覆盖；确需改由安装器管理请用 --force`,
			};
		}
		if (record !== undefined) {
			const modified = userModifiedDetail(existing, record);
			if (modified !== undefined) {
				return {
					kind: "skipped-user-modified",
					token: bundle.token,
					detail: `检测到用户改动：${modified}——跳过保护；覆盖请用 --force`,
				};
			}
				if (record.version === bundle.version) {
					// 同版本跳过也做 MCP 合并回填：装在特性之前的模块重跑安装即补档。
					return {
						kind: "skipped-up-to-date",
						token: bundle.token,
						detail: `已装同版本 ${bundle.version}，跳过（--force 重装）${mcpMergeDetail(options, bundle)}`,
					};
				}
		}
	}

	if (existsSync(moduleDir)) rmSync(moduleDir, { recursive: true, force: true });
	// 升级清理：上一版记录中、新版不再分发的文件（仅删哈希吻合的旧拷贝；
	// 用户改过的保留，残留会在下次安装以记录外文件显影）。
	if (record !== undefined) {
		const plannedPaths = new Set(planned.map((item) => item.projectRel));
		for (const file of record.files) {
			if (plannedPaths.has(file.path)) continue;
			const stale = join(projectRoot, file.path);
			try {
				if (existsSync(stale) && hashContent(readFileSync(stale, "utf8")) === file.hash) {
					rmSync(stale, { force: true });
				}
			} catch {
				// 删不动就留着：不是失败路径。
			}
		}
	}
	let bodyCount = 0;
	let agentCount = 0;
	let skillCount = 0;
	const recordFiles: { path: string; hash: string }[] = [];
	for (const item of planned) {
		writeFileAtomic(item.target, readFileSync(item.entry.abs, "utf8"));
		recordFiles.push({ path: item.projectRel, hash: hashContent(readFileSync(item.entry.abs, "utf8")) });
		if (item.entry.bundleRel.startsWith("agents/")) agentCount += 1;
		else if (item.entry.bundleRel.startsWith("skills/")) skillCount += 1;
		else bodyCount += 1;
	}

	const merged: Record<string, ModuleInstallRecord> = { ...installs.modules };
	merged[bundle.token] = { version: bundle.version, files: recordFiles };
	writeModuleInstalls(projectRoot, { schema: MODULE_INSTALLS_SCHEMA, modules: merged });

	const parts = [`模块本体 ${bodyCount} 文件 → .pi/modules/${bundle.token}/`];
	if (agentCount > 0) parts.push(`代理 ${agentCount} 文件 → .pi/agents/`);
	if (skillCount > 0) parts.push(`技能 ${skillCount} 文件 → .pi/skills/`);
	return { kind: "installed", token: bundle.token, detail: `已安装 ${bundle.token}@${bundle.version}：${parts.join("，")}${mcpMergeDetail(options, bundle)}` };
}

// —— /jero:doctor 诊断行：已装模块与包内模块束的版本漂移显影（只观察，不动手） ——
export function moduleDoctorLines(projectRoot: string): string[] {
	const installs = readModuleInstalls(projectRoot);
	const { bundles } = discoverBundles(bundleModulesRoot());
	const bundleByToken = new Map(bundles.map((bundle) => [bundle.token, bundle]));
	const recordedTokens = new Set(Object.keys(installs.modules));
	// 目录存在但无记录：安装器不接管（手工/创建器安装是合法形态，仅显影）。
	let moduleDirEntries: string[] = [];
	try {
		moduleDirEntries = readdirSync(join(projectRoot, ".pi", "modules"), { withFileTypes: true })
			.filter((entry) => entry.isDirectory() && existsSync(join(projectRoot, ".pi", "modules", entry.name, "module.json")))
			.map((entry) => entry.name);
	} catch {
		// 无模块根是正常态。
	}
	if (recordedTokens.size === 0 && moduleDirEntries.length === 0) {
		return ["info: Capability modules none installed (/jero:module-list to browse)"];
	}
	const lines: string[] = [];
	for (const token of moduleDirEntries) {
		if (!recordedTokens.has(token)) {
			lines.push(`warn: module ${token} present without install record (hand-installed; installer will not manage it)`);
		}
	}
	for (const [token, record] of Object.entries(installs.modules)) {
		const bundle = bundleByToken.get(token);
		if (bundle === undefined) {
			lines.push(`warn: installed module ${token}@${record.version} has no bundle in the package library (record kept)`);
		} else if (bundle.version !== record.version) {
			lines.push(`warn: module ${token} installed ${record.version}, package bundle ${bundle.version} (/jero:install-module ${token} to upgrade)`);
		} else {
			lines.push(`pass: module ${token}@${record.version} up to date`);
		}
	}
	return lines;
}

/**
 * /jero:doctor 的模块 MCP 诊断行：已装模块声明的 MCP 服务器在 agent
 * mcp.json 中的存在性显影（缺席→重装回填提示；同内容=pass；同内容不同
 * =用户改动保留）。只观察，不动手。
 */
export function moduleMcpDoctorLines(projectRoot: string, mcpJsonPath: string = agentMcpJsonPath()): string[] {
	const installs = readModuleInstalls(projectRoot);
	const { bundles } = discoverBundles(bundleModulesRoot());
	const declared: { token: string; server: McpServerSpec }[] = [];
	for (const bundle of bundles) {
		if (installs.modules[bundle.token] === undefined) continue;
		for (const server of bundle.manifest.mcp?.servers ?? []) declared.push({ token: bundle.token, server });
	}
	if (declared.length === 0) return [];
	let servers: Record<string, unknown> | undefined;
	if (existsSync(mcpJsonPath)) {
		try {
			const parsed: unknown = JSON.parse(readFileSync(mcpJsonPath, "utf8"));
			if (isPlainRecord(parsed) && isPlainRecord(parsed.mcpServers)) servers = parsed.mcpServers;
		} catch {
			// 不可解析按全体缺席显影。
		}
	}
	const lines: string[] = [];
	for (const { token, server } of declared) {
		const current = servers?.[server.name];
		if (current === undefined) {
			lines.push(`warn: module ${token} MCP server ${server.name} declared but missing in ${mcpJsonPath} (rerun /jero:install-module ${token})`);
		} else if (JSON.stringify(current) !== JSON.stringify(mcpServerEntry(server))) {
			lines.push(`info: module ${token} MCP server ${server.name} present with user-modified config (kept)`);
		} else {
			lines.push(`pass: module ${token} MCP server ${server.name} present in mcp.json`);
		}
	}
	return lines;
}
