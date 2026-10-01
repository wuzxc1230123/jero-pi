#!/usr/bin/env node
// jero-pi module-contract infrastructure gate. Three jobs:
//
//   1. Schema drift: the enums in schemas/module.schema.json must stay in
//      lockstep with the constants in lib/module-contract.ts. Editing one
//      without the other is exactly the silent-decay this gate exists to
//      stop — the schema is the published face, the TS constants are the
//      enforcement face. Includes the v2 contract-id enum and the
//      "dependencies only under v2" allOf branch.
//   2. Template green: skills/jero-module-creator/assets/module-manifest.template.json
//      (what jero-module-creator scaffolds from) must parse and pass install
//      verification, so creators never generate a manifest the verifier rejects.
//   3. Bundle library green: every assets/modules/{token}/module.json must
//      parse, pass install verification, carry every declared role as an
//      agents/{role}.md file, and only depend on tokens that exist as bundles
//      — the installer (/jero:install-module) ships exactly these.
//
// Runs via --experimental-strip-types (see package.json check:module-contract)
// so it can import the TS contract module directly — single source of truth.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
	BINDING_SURFACES,
	INJECT_LEVELS,
	ISOLATION_REASONS,
	MODEL_TIERS,
	MODULE_CONTRACT_IDS,
	MODULE_CONTRACT_V2,
	PERMISSION_PRESETS,
	ROUTING_ACTIONS,
	SLIP_DELIVERABLES,
	SLIP_IRREVERSIBILITY,
	SLIP_UTTERANCE_TYPES,
	parseModuleManifest,
	verifyModule,
} from "../lib/module-contract.ts";

const root = join(fileURLToPath(new URL("..", import.meta.url)));
const failures = [];

function expectList(label, actual, expected) {
	const actualJson = JSON.stringify(actual);
	const expectedJson = JSON.stringify([...expected]);
	if (actualJson !== expectedJson) {
		failures.push(`${label} 漂移：schema=${actualJson}，TS 常量=${expectedJson}`);
	}
}

// —— 1. schema 漂移检查 ——
const schema = JSON.parse(readFileSync(join(root, "schemas", "module.schema.json"), "utf8"));
const defs = schema.$defs ?? {};
expectList("$defs.surface", defs.surface?.enum, BINDING_SURFACES);
expectList("$defs.injectLevel", defs.injectLevel?.enum, INJECT_LEVELS);
expectList("$defs.isolationReason", defs.isolationReason?.enum, ISOLATION_REASONS);
expectList("$defs.modelTier", defs.modelTier?.enum, MODEL_TIERS);
expectList("$defs.permissionPreset", defs.permissionPreset?.enum, Object.keys(PERMISSION_PRESETS));
expectList("$defs.routingAction", defs.routingAction?.enum, ROUTING_ACTIONS);
expectList("$defs.slipUtteranceType", defs.slipUtteranceType?.enum, SLIP_UTTERANCE_TYPES);
expectList("$defs.slipDeliverable", defs.slipDeliverable?.enum, SLIP_DELIVERABLES);
expectList("$defs.slipIrreversibility", defs.slipIrreversibility?.enum, SLIP_IRREVERSIBILITY);
if (schema.title !== MODULE_CONTRACT_V2) {
	failures.push(`schema.title 与契约串不一致：${schema.title} vs ${MODULE_CONTRACT_V2}`);
}
expectList("properties.schema.enum", schema.properties?.schema?.enum, MODULE_CONTRACT_IDS);
// "dependencies 仅 v2 可用"的 schema 侧钉子：v1 分支必须显式禁止该键。
if (schema.allOf?.[0]?.then?.properties?.dependencies !== false) {
	failures.push("schema.allOf 缺少 v1 禁止 dependencies 的分支（then.properties.dependencies === false）");
}

// —— 2. 模板清单必须绿灯 ——
const templateRaw = readFileSync(
	join(root, "skills", "jero-module-creator", "assets", "module-manifest.template.json"),
	"utf8",
);
const parsed = parseModuleManifest(templateRaw);
if (parsed.issues.length > 0 || parsed.manifest === undefined) {
	failures.push(`模板清单解析失败：${parsed.issues.map((item) => `${item.path}: ${item.message}`).join("；")}`);
} else {
	// entry 金样同目录存放（创建器的 L1 模板），门用它跑完整 entry-size 链路。
	let entryText;
	try {
		entryText = readFileSync(
			join(root, "skills", "jero-module-creator", "assets", "module-entry.template.md"),
			"utf8",
		);
	} catch (error) {
		failures.push(`entry 金样缺失或不可读：${error instanceof Error ? error.message : String(error)}`);
	}
	const report = verifyModule({
		manifest: parsed.manifest,
		entryText,
		repoFiles: ["project.godot", "scenes/main.tscn", "src/main.gd"],
	});
	const failed = report.checks.filter((item) => item.status === "fail");
	if (failed.length > 0) {
		failures.push(`模板清单未过安装验证：${failed.map((item) => `${item.id}（${item.detail}）`).join("；")}`);
	}
}

// —— 3. 包内模块库（assets/modules）必须绿灯 ——
const bundlesRoot = join(root, "assets", "modules");
if (existsSync(bundlesRoot)) {
	const bundleDirs = readdirSync(bundlesRoot, { withFileTypes: true })
		.filter((entry) => entry.isDirectory())
		.map((entry) => entry.name)
		.toSorted();
	const bundleTokens = [];
	for (const dirName of bundleDirs) {
		const dir = join(bundlesRoot, dirName);
		const parsedBundle = parseModuleManifest(readFileSync(join(dir, "module.json"), "utf8"));
		if (parsedBundle.issues.length > 0 || parsedBundle.manifest === undefined) {
			failures.push(`模块束 ${dirName} 清单解析失败：${parsedBundle.issues.map((item) => `${item.path}: ${item.message}`).join("；")}`);
			continue;
		}
		const manifest = parsedBundle.manifest;
		bundleTokens.push(manifest.token);
		// roles 与包内 agents/ 一一对应：安装器照此拷贝 .pi/agents/，缺文件即断链。
		const agentsDir = join(dir, "agents");
		const agentFiles = existsSync(agentsDir)
			? readdirSync(agentsDir).filter((name) => name.endsWith(".md")).toSorted()
			: [];
		const expectedAgents = manifest.roles.map((role) => `${role.name}.md`).toSorted();
		if (JSON.stringify(agentFiles) !== JSON.stringify(expectedAgents)) {
			failures.push(`模块束 ${manifest.token} 的 roles 与 agents/ 文件不一致：清单要 [${expectedAgents.join(", ")}]，目录有 [${agentFiles.join(", ")}]`);
		}
		// 触发命中样本：用清单里的非 glob 触发文件作字面量仓库文件（确定性命中）。
		const literalTriggers = manifest.triggers.files.filter((file) => !file.includes("*"));
		const report = verifyModule({
			manifest,
			entryText: readFileSync(join(dir, manifest.knowledge.entry), "utf8"),
			repoFiles: literalTriggers.length > 0 ? literalTriggers : [".keep"],
			otherTokens: bundleTokens.filter((token) => token !== manifest.token),
		});
		const failed = report.checks.filter((item) => item.status === "fail");
		if (failed.length > 0) {
			failures.push(`模块束 ${manifest.token} 未过安装验证：${failed.map((item) => `${item.id}（${item.detail}）`).join("；")}`);
		}
	}
	// 依赖闭包在库内必须可解析：缺束即安装器无法履行的承诺。
	for (const dirName of bundleDirs) {
		const parsedBundle = parseModuleManifest(readFileSync(join(bundlesRoot, dirName, "module.json"), "utf8"));
		const deps = parsedBundle.manifest?.dependencies ?? [];
		const missing = deps.filter((dep) => !bundleTokens.includes(dep));
		if (missing.length > 0) {
			failures.push(`模块束 ${parsedBundle.manifest?.token ?? dirName} 依赖了库内不存在的词元：${missing.join("、")}`);
		}
	}
}

if (failures.length > 0) {
	console.error("check:module-contract 失败：");
	for (const failure of failures) console.error(`  - ${failure}`);
	process.exit(1);
}
console.log("check:module-contract 通过：schema 无漂移，模板与包内模块库全部绿灯。");
