#!/usr/bin/env node
// jero-pi package verification (adapted from gentle-pi for the zero-binary
// posture, design §5.5): required Pi resources must exist, the relocated
// review-integration golden vectors must stay byte-exact, the generated
// runtime must match its TypeScript sources, and — new for jero-pi — the
// forbidden list must prove no binary/installer/telemetry/provider-mirror
// residue exists anywhere in the package.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(fileURLToPath(new URL("..", import.meta.url)));

const requiredPaths = [
	"assets/orchestrator.md",
	"assets/orchestrator-delegation.md",
	"assets/orchestrator-memory.md",
	"assets/orchestrator-skills.md",
	"assets/sdd-orchestrator-workflow.md",
	"assets/agents/jero-explore.md",
	"assets/agents/jero-verify.md",
	"assets/agents/jero-worker.md",
	"assets/agents/jd-fix-agent.md",
	"assets/agents/jd-judge-a.md",
	"assets/agents/jd-judge-b.md",
	"assets/agents/review-readability.md",
	"assets/agents/review-reliability.md",
	"assets/agents/review-resilience.md",
	"assets/agents/review-risk.md",
	"assets/agents/sdd-apply.md",
	"assets/agents/sdd-archive.md",
	"assets/agents/sdd-design.md",
	"assets/agents/sdd-explore.md",
	"assets/agents/sdd-init.md",
	"assets/agents/sdd-onboard.md",
	"assets/agents/sdd-proposal.md",
	"assets/agents/sdd-remediate.md",
	"assets/agents/sdd-research.md",
	"assets/agents/sdd-spec.md",
	"assets/agents/sdd-status.md",
	"assets/agents/sdd-sync.md",
	"assets/agents/sdd-tasks.md",
	"assets/agents/sdd-verify.md",
	"assets/chains/4r-review.chain.md",
	"assets/chains/sdd-full.chain.md",
	"assets/chains/sdd-plan.chain.md",
	"assets/chains/sdd-verify.chain.md",
	"assets/migrations/managed-assets-v0.10.7.json",
	"assets/migrations/managed-assets-v0.13.json",
	"assets/migrations/managed-assets-v0.14.json",
	"assets/support/sdd-status-contract.md",
	"assets/support/strict-tdd.md",
	"assets/support/strict-tdd-verify.md",
	"extensions/jero-ai.ts",
	"extensions/jero-memory.ts",
	"lib/memory.ts",
	"extensions/sdd-init.ts",
	"extensions/skill-registry.ts",
	"lib/authority/client-contract.ts",
	"lib/review-host-relay.ts",
	"lib/authority/wire-contract.ts",
	"lib/sdd-preflight.ts",
	"runtime/client-contract.mjs",
	"runtime/client-contract-decode.mjs",
	"runtime/client-contract-surface.mjs",
	"runtime/client-contract-types.mjs",
	"runtime/wire-contract.mjs",
	"runtime/wire-contract-decode-helpers.mjs",
	"runtime/wire-contract-decode-start.mjs",
	"runtime/wire-contract-decode-status.mjs",
	"runtime/wire-contract-enums.mjs",
	"runtime/wire-contract-interfaces.mjs",
	"runtime/wire-contract-last-event.mjs",
	"runtime/review-risk-assessment.mjs",
	"runtime/record-utils.mjs",
	"tests/fixtures/native-review-cli/v2.1.3/start.json",
	"prompts/agents-init.md",
	"prompts/skill-creation.md",
	"schemas/runtime-aggregate-v1.schema.json",
	"skills/_shared/review-ledger-contract.md",
	"skills/branch-pr/SKILL.md",
	"skills/chained-pr/SKILL.md",
	"skills/cognitive-doc-design/SKILL.md",
	"skills/comment-writer/SKILL.md",
	"skills/jero-ai/SKILL.md",
	"skills/issue-creation/SKILL.md",
	"skills/judgment-day/SKILL.md",
	"skills/rdd-defect-workflow/SKILL.md",
	"skills/release/SKILL.md",
	"skills/skill-creator/SKILL.md",
	"skills/skill-improver/SKILL.md",
	"skills/skill-registry/SKILL.md",
	"skills/work-unit-commits/SKILL.md",
	"scripts/test-packed-runner.mjs",
];

// jero-pi P1/P4 gate: none of the deleted distribution-chain files may
// reappear in the package. The list mirrors design §6 rows marked D/R.
// D6 dual-implementation ban extends here: the retired built-in todo
// (extension + pure-function card lib) stays deleted — the rpiv-todo
// companion owns the `todo` tool.
const forbiddenPaths = [
	"scripts/install-gentle-ai.mjs",
	"scripts/gentle-ai-installer.mjs",
	"scripts/mirror-provider-contract.mjs",
	"scripts/check-provider-contract.mjs",
	"scripts/measure-native-authority-slimming.mjs",
	"lib/gentle-ai-binary.ts",
	"lib/provider-contract-bundle.ts",
	"lib/telemetry-trigger.ts",
	"lib/runtime-metrics-delivery.ts",
	"lib/runtime-metrics-native.ts",
	"lib/runtime-metrics-policy.ts",
	"lib/review-legacy-detector.ts",
	"lib/review-relay-contract.ts",
	"runtime/review-relay-contract.mjs",
	"lib/native-review-authority-quarantine.ts",
	"lib/quiet-tools-config.ts",
	"runtime/gentle-ai-binary.mjs",
	"runtime/telemetry-trigger.mjs",
	"extensions/quiet-tools.ts",
	"extensions/ask-user-choice.ts",
	"extensions/codegraph-tools.ts",
	"extensions/pi-pretty.ts",
	"extensions/jero-todo.ts",
	"lib/shell-todo.ts",
	"contracts",
];

// Golden vectors relocated from the upstream contracts/ tree (design §5.1.7):
// byte-exactness survives the move, so the upstream-pinned SHA-256 values
// carry over unchanged. These bytes are the behavioral spec for lib/authority/
// conformance at P2.
const contractHashes = {
	"schemas/runtime-aggregate-v1.schema.json": "fa76fb931029b2044d575358ac2bc001bcf461ff91ac0e0e2db6ac2e0970b510",
	"tests/fixtures/review-integration/v1/fixtures/binding-revision-conflict.fixture.json": "c2e294843cee5185324cb7a41702574ef94852517239d99e7493a1414a60b363",
	"tests/fixtures/review-integration/v1/fixtures/capabilities-v1.1.fixture.json": "1b3dc40dce7bfb5d3ecc7e92af68d66e71b733ba0b0f71ba94d3c633adc48bcf",
	"tests/fixtures/review-integration/v1/fixtures/capabilities-v1.2.fixture.json": "2970d21cd95a7fcaea6547c47a591a5151046e7ede658b3e8c5b9a9c5d106b65",
	"tests/fixtures/review-integration/v1/fixtures/capabilities-v1.3.fixture.json": "0ec783ea13b4c82c0b002c5caa758f33e2b488537297cc2d0694ec92176ac0cb",
	"tests/fixtures/review-integration/v1/fixtures/capabilities-v1.4.fixture.json": "84e0db457b76b97b35c2be772dfc647f9eab66810ea98f64fed85645c3c266ba",
	"tests/fixtures/review-integration/v1/fixtures/capabilities-v1.5.fixture.json": "0cc952af3767c393bde9e4785e4071615a529fd672bc94da4fcc204780524a27",
	"tests/fixtures/review-integration/v1/fixtures/capabilities.fixture.json": "b3ca822189a236f2d891628c665ca23e308bf5185a1701e1f07231bd970461bb",
	"tests/fixtures/review-integration/v1/fixtures/consent.fixture.json": "28c7c86b55f8c9dbae3a1baa8fe298c4f3a14664aba21cd4051c7f579a61a4e9",
	"tests/fixtures/review-integration/v1/fixtures/failure.fixture.json": "e72b6ab5e3c529abac47bd324444f84ca90f67ef0a67189f5fd8d24d199a2759",
	"tests/fixtures/review-integration/v1/fixtures/final-verification-incident.fixture.json": "f8bc06549e62b0bee5cf2ecde625e18da178dd18c9d3023b7d7e8fd0ebbba646",
	"tests/fixtures/review-integration/v1/fixtures/operation.fixture.json": "3547748a4df57382178064abbdb1cf12f1d58a75c0e9d6452fdd9beb3aaeac3a",
	"tests/fixtures/review-integration/v1/fixtures/repair-preflight.fixture.json": "7168cb53ad470066d0b3edc3b7911d1aebff91abd41ecc3d822f8ffa5cea6cb1",
	"tests/fixtures/review-integration/v1/fixtures/start-v2.fixture.json": "2699660832c0d944184d5d314f08774ab9a02f5b8a7a4c2a07983440e0e346ad",
	"tests/fixtures/review-integration/v1/fixtures/start.fixture.json": "3b963b221cd1560eb8872cbabbb5407096f593ced2f13eb9cb06eb61e4cca4d1",
	"tests/fixtures/review-integration/v1/fixtures/status-ambiguous.fixture.json": "ee695fd58ba72adfb3b51dfd16432a177498173a45bfcb594d6bdc53bfa32e6e",
	"tests/fixtures/review-integration/v1/fixtures/status-corrupted.fixture.json": "4cfc0048c28a39cec8a32fecfaad66e56e5c1248263ceb4ce66b6717981880b2",
	"tests/fixtures/review-integration/v1/fixtures/status-recover.fixture.json": "714f762f72380ce93d567626cafbaa536ab3aae02af73d3d40ca123f1f30d8b0",
	"tests/fixtures/review-integration/v1/fixtures/status-unrelated.fixture.json": "deab36c877ced3c9b480ca33724c10d88f75c761d6426fa14be850345122891d",
	"tests/fixtures/review-integration/v1/fixtures/status-v2-ambiguous.fixture.json": "80a459a7a18d8d933dd42acb6a94a75ac19278e9a6c3b125e3017946768eaa47",
	"tests/fixtures/review-integration/v1/fixtures/status-v2-corrupted.fixture.json": "466f1e28b101e95178630f26a90fff96ad3516e2aa6a17f5f357bab9bda2ab52",
	"tests/fixtures/review-integration/v1/fixtures/status-v2-final-verification-retry.fixture.json": "889ede9a84bdbe561df2d2401adda95634582c44db9d1075ba839f33d65c7886",
	"tests/fixtures/review-integration/v1/fixtures/status-v2-recover.fixture.json": "178331fc7177d2316fd4f56610ac295f7da2780be96b233b72935d5f476610f2",
	"tests/fixtures/review-integration/v1/fixtures/status-v2-repair.fixture.json": "89083cad752fca38da09e919825d0b80641a8a029364ba1869e5b58ef2e59a1d",
	"tests/fixtures/review-integration/v1/fixtures/status-v2-unrelated.fixture.json": "c178b338dcd5d30888acef37a9d752bd0932d6dedfffb61b0596a9cceabeb692",
	"tests/fixtures/review-integration/v1/fixtures/status-v2.fixture.json": "33c5032dcd5d916b4bff73781495640da83893b2f2b334465cbb40c18e1b85f4",
	"tests/fixtures/review-integration/v1/fixtures/status.fixture.json": "555054d8046a896162995dcb117752f9cd1ef903fb9ebaad29af1b7e7f319bb3",
	"tests/fixtures/review-integration/v1/fixtures/verification-evidence.fixture.json": "b30e3863548845b90e256d92193435d02da458bf8f15a4c33d023cd1f6894a5f",
	"tests/fixtures/review-integration/v1/schemas/admitted-result.schema.json": "7796e8dbba331434594108c902dfab7ec46f691fa447a9259a78f2448111b0de",
	"tests/fixtures/review-integration/v1/schemas/artifact-subject.schema.json": "f7dcd934e27e8f3735a37f3d0ec8048dd8ccc1811b9df61124a1dcbf8a03f40e",
	"tests/fixtures/review-integration/v1/schemas/authority-repair-assessment.schema.json": "232591670009f99c53a68e91d1e7e60465c294f1721f493ab1e7ae182842cfb5",
	"tests/fixtures/review-integration/v1/schemas/capabilities-v1.1.schema.json": "2b14162284f375f8563e49d3a28caaa0aabb572094d8d290eb61844b1353af78",
	"tests/fixtures/review-integration/v1/schemas/capabilities-v1.2.schema.json": "df1722adcd9c999edbef090bfd5d9a9713f6852a9bc9cb79684ef7c9c91c0d62",
	"tests/fixtures/review-integration/v1/schemas/capabilities-v1.3.schema.json": "3401a062fa8a034ef7743f84adbfdd2ceadaf81bee8a7e62115fd4e18afacfcd",
	"tests/fixtures/review-integration/v1/schemas/capabilities-v1.4.schema.json": "926b61c8ac0f870f09214f6bd8af1b035c5b72f14f0b83c0d4a7bdbb277f5447",
	"tests/fixtures/review-integration/v1/schemas/capabilities-v1.5.schema.json": "abc783821524dcc33339495284805a85f79b3352efb7358c95016ed164bd7f24",
	"tests/fixtures/review-integration/v1/schemas/capabilities.schema.json": "ad333177494a251beac153f74bd751fa77126a9968aad69e64fc2abf15cff0f7",
	"tests/fixtures/review-integration/v1/schemas/consent.schema.json": "f8f2edec17568124488482c2aee399909111fe0cce2cba426fb29efd2c7c1cd0",
	"tests/fixtures/review-integration/v1/schemas/correction-plan-request.schema.json": "77bf357afc9bee288d64ce64e87b4e13347b1d0ed5e824a9cea6dc0621b40ed1",
	"tests/fixtures/review-integration/v1/schemas/failure.schema.json": "0ce29f61408fc21d72640fffdb215a608a820c29f3e5ff62d9cc295ed0451937",
	"tests/fixtures/review-integration/v1/schemas/final-verification-incident.schema.json": "39b1ec178b1d3bc8da9a3d92dadd8092385000f2a6930b5bfcb4a84dbc6493ca",
	"tests/fixtures/review-integration/v1/schemas/operation.schema.json": "495d66c6cdb6b2b634bc580b80125073d802226186db9f000456e111315ac0da",
	"tests/fixtures/review-integration/v1/schemas/projection.schema.json": "7168a3eba929dde2b8f0b7723ee51d5a5421102bdeefe892578c263debd08db2",
	"tests/fixtures/review-integration/v1/schemas/repair.schema.json": "2939a9f6e68e5b6964db541d7b1a75054113c75a6f836a158ce0f37e1c4ebe32",
	"tests/fixtures/review-integration/v1/schemas/result-artifact-v2.schema.json": "38895aae2f6ca4980b1a8e157fee8503920820d5f6be3c757c0fa04e8430cd6b",
	"tests/fixtures/review-integration/v1/schemas/result-artifact.schema.json": "91296bd2c261fd2fe03bffd63efe58badd4927e0d0d8480cd4213f651ecacdf6",
	"tests/fixtures/review-integration/v1/schemas/start-v2.schema.json": "ec8550cd93bbe84af1ce87dfd7abfa9e24692f42b20f8f0bf9cac1d4b88ea46c",
	"tests/fixtures/review-integration/v1/schemas/start.schema.json": "4296aebbd4128ce51945a2f6d3228aa77ac7215c802978d559bff5279ec56229",
	"tests/fixtures/review-integration/v1/schemas/status-v2.schema.json": "dd9914b647a1d9edc4ecdcbed4f0c800b39ec290912d5c2a4cc6ba3098d5f21e",
	"tests/fixtures/review-integration/v1/schemas/status.schema.json": "250d2c646b8822b38eaefafd2bfdefa1134cc23a00e553a7201f33257573149a",
	"tests/fixtures/review-integration/v1/schemas/targeted-validation-request.schema.json": "52b91154693b4dd66983fc91ecf7197503555f2c9e85cac626cffd3035c53d65",
	"tests/fixtures/review-integration/v1/schemas/transition-execution.schema.json": "ddee03bd0c1b6e70f21c399bae7fe528aa4ad46cebb5a48ec72b6e6b3694aa2d",
	"tests/fixtures/review-integration/v1/schemas/verification-evidence.schema.json": "fd15890bf2ef1db95d771ee7f468e9e64014351d7940f65604eb24f41e68a22f",
	"tests/fixtures/review-integration/v2/fixtures/capabilities.fixture.json": "17c150d851c15b3f0c20d18c2e2741eb2232ffa24f35aa71d6d30e90a85e42b7",
	"tests/fixtures/review-integration/v2/fixtures/consent.fixture.json": "203cc96d5c29ba0f27b5c4db04c2e88566e0a923d3a0cdb317f78d9065349075",
	"tests/fixtures/review-integration/v2/fixtures/start.fixture.json": "bd82bfb386c01809d8f1c5cb3a4b3b540f7cb23a55209505680daeb43b4e8642",
	"tests/fixtures/review-integration/v2/fixtures/status.fixture.json": "4cd77906bacdca35d8f99773de147211d2b05fe34dd1b999011ead09e84be7a5",
	"tests/fixtures/review-integration/v2/schemas/admitted-result.schema.json": "c6a9c880191d65c46d9cfc8a0812af16b636573a8f6e57ea34aa16d6f6bb9735",
	"tests/fixtures/review-integration/v2/schemas/artifact-subject.schema.json": "3e71a81340ea6149b03afa71530d10ce654c415fa21d4e07f0c9c25b3d2d70a3",
	"tests/fixtures/review-integration/v2/schemas/capabilities.schema.json": "7ab061ed27bd3b929d6033cc20f56097e851f4454ca14a815255748b50191248",
	"tests/fixtures/review-integration/v2/schemas/consent.schema.json": "b2b4465338497f11927de91cb2e5da12b6cb4a1039afe05aebe1abbf53b21858",
	"tests/fixtures/review-integration/v2/schemas/failure.schema.json": "a56a2f715c3138d6f2cee37257cd6e758a15d4e0b1215745951d85831d148967",
	"tests/fixtures/review-integration/v2/schemas/last-event-closure.schema.json": "612531204afa5941e4927c38e868c720a4519fe4b9a5a4ffd29f021dc053001d",
	"tests/fixtures/review-integration/v2/schemas/opencode-provider-role.schema.json": "c6b9f216f89c044f8e844b55e7200114850cfbc16642bca0677f30a399d8aa9b",
	"tests/fixtures/review-integration/v2/schemas/operation.schema.json": "1c0128a0576064d4338ee0a1945e9d0d0569c1a7a2140217b2539af5d1a9ed1e",
	"tests/fixtures/review-integration/v2/schemas/repair.schema.json": "98a85fd45a8ae7f6211ffeeb3f9c478fa1dd1c17f385751f15f2111e6c3ab167",
	"tests/fixtures/review-integration/v2/schemas/start.schema.json": "2991e3fcca672d9257d61b6a336fb34e58b15a8e03f8a09a7adf892cae6a8085",
	"tests/fixtures/review-integration/v2/schemas/status.schema.json": "c4dcc736cfc6300560a3c4262d2d982368529d5c49d58d499552a3b0beef9212",
};

requiredPaths.push(...Object.keys(contractHashes));

function listFilesRecursively(directory) {
	return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
		const absolutePath = join(directory, entry.name);
		if (entry.isDirectory()) return listFilesRecursively(absolutePath);
		return entry.isFile() ? [absolutePath] : [];
	});
}

// Walks the relocated golden-vector tree on disk and reconciles it against
// `contractHashes` (restricted to `tests/fixtures/review-integration/**` keys
// — other hash entries, e.g. the runtime aggregate schema, live outside this
// walk root). Reports the two drift directions separately so a new unlisted
// file and a stale hash-map entry are both visible.
export function reconcileContractsOnDisk(packageRoot, hashes) {
	const contractsRoot = join(packageRoot, "tests", "fixtures", "review-integration");
	const listed = Object.keys(hashes).filter((relativePath) => relativePath.startsWith("tests/fixtures/review-integration/"));
	if (!existsSync(contractsRoot)) return { unlistedOnDisk: [], listedButMissing: [...listed].sort() };
	const walked = listFilesRecursively(contractsRoot)
		.map((absolutePath) => relative(packageRoot, absolutePath).split(sep).join("/"));
	const walkedSet = new Set(walked);
	const listedSet = new Set(listed);
	return {
		unlistedOnDisk: walked.filter((relativePath) => !listedSet.has(relativePath)).sort(),
		listedButMissing: listed.filter((relativePath) => !walkedSet.has(relativePath)).sort(),
	};
}

// Reads the generator's `sources` array by regex rather than importing it,
// so this script never needs the generator to export anything it doesn't
// already export for its own `--write`/`--check` CLI use.
export function extractGeneratedRuntimeSources(packageRoot) {
	const generatorPath = join(packageRoot, "scripts/build-runtime-modules.mjs");
	const generatorSource = readFileSync(generatorPath, "utf8");
	const sourcesMatch = generatorSource.match(/const sources = \[([\s\S]*?)\];/);
	if (!sourcesMatch) {
		throw new Error(`${generatorPath} does not declare a "sources" array`);
	}
	return [...sourcesMatch[1].matchAll(/"([^"]+)"/g)].map((match) => match[1]);
}

// Three-way reconciliation: the generator's `sources` names must equal the
// `.mjs` basenames on disk in `runtime/`, which must equal the `runtime/`
// entries in `requiredPaths`. Deliberately not a `lib/`-driven walk: most
// `lib/` modules are intentionally unpaired with a generated runtime file.
export function reconcileGeneratedRuntimeSources(packageRoot, sources, paths) {
	const runtimeRoot = join(packageRoot, "runtime");
	const runtimeBasenames = existsSync(runtimeRoot)
		? readdirSync(runtimeRoot)
			.filter((name) => name.endsWith(".mjs"))
			.map((name) => name.slice(0, -".mjs".length))
		: [];
	const requiredRuntimeBasenames = paths
		.filter((relativePath) => relativePath.startsWith("runtime/") && relativePath.endsWith(".mjs"))
		.map((relativePath) => relativePath.slice("runtime/".length, -".mjs".length));

	// Generator `sources` entries carry their lib/ directory prefix
	// (`authority/wire-contract` -> runtime `wire-contract.mjs`); reconcile on
	// basenames exactly like the generator's own destination naming does.
	const sourceSet = new Set(sources.map((name) => name.split("/").pop()));
	const runtimeSet = new Set(runtimeBasenames);
	const requiredSet = new Set(requiredRuntimeBasenames);
	const names = new Set([...sourceSet, ...runtimeSet, ...requiredSet]);

	const drifted = [...names]
		.filter((name) => !(sourceSet.has(name) && runtimeSet.has(name) && requiredSet.has(name)))
		.sort()
		.map((name) => ({
			name,
			inSources: sourceSet.has(name),
			inRuntimeDir: runtimeSet.has(name),
			inRequiredPaths: requiredSet.has(name),
		}));

	return { drifted };
}

async function main() {
	const missing = requiredPaths.filter((relativePath) => {
		const absolutePath = join(root, relativePath);
		return !existsSync(absolutePath) || !statSync(absolutePath).isFile();
	});

	if (missing.length > 0) {
		console.error("jero-pi package is missing required Pi resources:");
		for (const relativePath of missing) console.error(`- ${relativePath}`);
		console.error("\nRefusing to pack/publish an incomplete npm package.");
		process.exit(1);
	}

	const present = forbiddenPaths.filter((relativePath) => existsSync(join(root, relativePath)));
	if (present.length > 0) {
		console.error("jero-pi package contains deleted distribution-chain files (zero-binary posture violated):");
		for (const relativePath of present) console.error(`- forbidden path present: ${relativePath}`);
		console.error("\nRefusing to pack/publish while binary/installer/telemetry residue exists.");
		process.exit(1);
	}

	const { unlistedOnDisk, listedButMissing } = reconcileContractsOnDisk(root, contractHashes);
	if (unlistedOnDisk.length > 0 || listedButMissing.length > 0) {
		console.error("jero-pi golden-vector tree has drifted from contractHashes:");
		for (const relativePath of unlistedOnDisk) console.error(`- unlisted-on-disk: ${relativePath}`);
		for (const relativePath of listedButMissing) console.error(`- listed-but-missing: ${relativePath}`);
		console.error("\nRefusing to pack/publish an unreconciled golden-vector tree.");
		process.exit(1);
	}

	const generatedRuntimeSources = extractGeneratedRuntimeSources(root);
	const { drifted } = reconcileGeneratedRuntimeSources(root, generatedRuntimeSources, requiredPaths);
	if (drifted.length > 0) {
		console.error("jero-pi generated runtime sources, runtime/*.mjs, and requiredPaths have drifted apart:");
		for (const entry of drifted) {
			const where = [];
			if (!entry.inSources) where.push("missing from generator sources");
			if (!entry.inRuntimeDir) where.push("missing from runtime/*.mjs");
			if (!entry.inRequiredPaths) where.push("missing from requiredPaths");
			console.error(`- ${entry.name}: ${where.join(", ")}`);
		}
		console.error("\nRefusing to pack/publish an unreconciled generated runtime.");
		process.exit(1);
	}

	const driftedContracts = Object.entries(contractHashes).flatMap(([relativePath, expected]) => {
		const actual = createHash("sha256").update(readFileSync(join(root, relativePath))).digest("hex");
		return actual === expected ? [] : [{ relativePath, expected, actual }];
	});

	if (driftedContracts.length > 0) {
		console.error("jero-pi golden vectors drifted from the pinned upstream v2.9.1 behavioral spec:");
		for (const drift of driftedContracts) console.error(`- ${drift.relativePath}: expected ${drift.expected}, got ${drift.actual}`);
		process.exit(1);
	}

	const generatedRuntimeCheck = spawnSync(process.execPath, [join(root, "scripts/build-runtime-modules.mjs"), "--check"], {
		cwd: root,
		encoding: "utf8",
		env: { ...process.env, NODE_NO_WARNINGS: "1" },
	});
	if (generatedRuntimeCheck.status !== 0) {
		console.error("jero-pi generated runtime does not match its TypeScript sources:");
		console.error((generatedRuntimeCheck.stderr || generatedRuntimeCheck.stdout || "unknown generator failure").trim());
		process.exit(1);
	}

	console.log(`jero-pi package resource check passed (${requiredPaths.length} files; ${Object.keys(contractHashes).length} byte-pinned golden vectors; ${forbiddenPaths.length} forbidden paths absent).`);
}

const isMainModule = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMainModule) {
	await main();
}
