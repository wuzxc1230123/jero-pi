#!/usr/bin/env node
// jero-pi module-contract infrastructure gate. Two jobs:
//
//   1. Schema drift: the enums in schemas/module.schema.json must stay in
//      lockstep with the constants in lib/module-contract.ts. Editing one
//      without the other is exactly the silent-decay this gate exists to
//      stop — the schema is the published face, the TS constants are the
//      enforcement face.
//   2. Template green: skills/jero-module-creator/assets/module-manifest.template.json
//      (what jero-module-creator scaffolds from) must parse and pass install
//      verification, so creators never generate a manifest the verifier rejects.
//
// Runs via --experimental-strip-types (see package.json check:module-contract)
// so it can import the TS contract module directly — single source of truth.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
	BINDING_SURFACES,
	INJECT_LEVELS,
	ISOLATION_REASONS,
	MODEL_TIERS,
	MODULE_CONTRACT_ID,
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
if (schema.title !== MODULE_CONTRACT_ID) {
	failures.push(`schema.title 与契约串不一致：${schema.title} vs ${MODULE_CONTRACT_ID}`);
}
if (schema.properties?.schema?.const !== MODULE_CONTRACT_ID) {
	failures.push("schema.properties.schema.const 与 MODULE_CONTRACT_ID 不一致");
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

if (failures.length > 0) {
	console.error("check:module-contract 失败：");
	for (const failure of failures) console.error(`  - ${failure}`);
	process.exit(1);
}
console.log("check:module-contract 通过：schema 无漂移，模板清单绿灯。");
