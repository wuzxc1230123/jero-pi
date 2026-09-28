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
	"prompts/agent-creation.md",
	"prompts/module-creation.md",
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
	"skills/jero-agent-creator/SKILL.md",
	"skills/jero-agent-creator/assets/reviewer.template.md",
	"skills/jero-agent-creator/assets/designer.template.md",
	"skills/jero-module-creator/SKILL.md",
	"skills/jero-module-creator/assets/interview.md",
	"skills/jero-module-creator/assets/module-skill.template.md",
	"skills/jero-module-creator/assets/config-pins.template.yaml",
	"skills/skill-creator/SKILL.md",
	"skills/skill-improver/SKILL.md",
	"skills/skill-registry/SKILL.md",
	"skills/work-unit-commits/SKILL.md",
	"scripts/test-packed-runner.mjs",
	"scripts/host-boot-smoke.mjs",
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
	"tests/fixtures/review-integration/v1/fixtures/binding-revision-conflict.fixture.json": "b69c8c77c7a96de2f085bf00ad74f65ed1640bde19c37da3b75c4e469bb6167a",
	"tests/fixtures/review-integration/v1/fixtures/capabilities-v1.1.fixture.json": "bc7a7fed99ce78fc4366d56f68fe6d5be1103f4174d05049cac1d5ba58a2edee",
	"tests/fixtures/review-integration/v1/fixtures/capabilities-v1.2.fixture.json": "3e20c16a1bfada6dc94d1a60b501a3bdf4f6dff3509baa3166b0db649975972f",
	"tests/fixtures/review-integration/v1/fixtures/capabilities-v1.3.fixture.json": "ea6daf99c58b74b929a0861f563c06ecc3a9b070df57f5becb7077ecc60d30b3",
	"tests/fixtures/review-integration/v1/fixtures/capabilities-v1.4.fixture.json": "bd28e03a755dee432325eb15bb5c21a99709eb1fd5146b2f411d4f2f169b364f",
	"tests/fixtures/review-integration/v1/fixtures/capabilities-v1.5.fixture.json": "8bf94baf64b5f9cf81655258c934d3e869075eda293ab895e2e9378993ba9277",
	"tests/fixtures/review-integration/v1/fixtures/capabilities.fixture.json": "5bca649237377fe397eaa9ae7155c9683e28a28a1721126f050ef9ee4914d548",
	"tests/fixtures/review-integration/v1/fixtures/consent.fixture.json": "581c70d77bfb017ce419f52945f681e71a991f849a1fbf9bc37a976f4f419a37",
	"tests/fixtures/review-integration/v1/fixtures/failure.fixture.json": "4b281fb5473098c76a120fac0408f5a1a2dc7e46a215949bb9425b1dafa47624",
	"tests/fixtures/review-integration/v1/fixtures/final-verification-incident.fixture.json": "565f92cbf3d54ac4fb59bd03002b7cc9368097cf93040a08c0b79d2711b48c7e",
	"tests/fixtures/review-integration/v1/fixtures/operation.fixture.json": "13cb520a8516fc695cb71f23081b8462fa7e00a6f1473da3a361fa6f3cc153b6",
	"tests/fixtures/review-integration/v1/fixtures/repair-preflight.fixture.json": "43d72de7e2d53bc2474093d7f72454c6ca548f11edd156ff9ad48aef35c35d14",
	"tests/fixtures/review-integration/v1/fixtures/start-v2.fixture.json": "d27b73e04608ba434de33ff0b72d46c16484160b27f2761fd462e27b0afc2c7d",
	"tests/fixtures/review-integration/v1/fixtures/start.fixture.json": "75975f4fe329e93cfd0c256359150a1e27b0ea4785767492090ed98651a0014b",
	"tests/fixtures/review-integration/v1/fixtures/status-ambiguous.fixture.json": "fec2a9748b8961fc5615d57388c474083bef80277e99a65cf7ffc22bff511d49",
	"tests/fixtures/review-integration/v1/fixtures/status-corrupted.fixture.json": "675832bce8937d467762bf70d21d8666e5537ec1b373c77c7694e2497e6cfdf6",
	"tests/fixtures/review-integration/v1/fixtures/status-recover.fixture.json": "33e512587e3a1b744311e0b7337df1af5a1daadf338f0b649d33b7287ca82e16",
	"tests/fixtures/review-integration/v1/fixtures/status-unrelated.fixture.json": "4814ba7c5c71703e59996564d276bf49a38796e5c26c45cefaa00c2d0a4b3d43",
	"tests/fixtures/review-integration/v1/fixtures/status-v2-ambiguous.fixture.json": "67c88d14d3051c5816f0c42791e3f5dcaa349e81d3e940efb50f69e1903536a0",
	"tests/fixtures/review-integration/v1/fixtures/status-v2-corrupted.fixture.json": "3458e5bc07da56c727d8f6a20fc2a4509d065cda9b6a79850353b68ab9e55fd1",
	"tests/fixtures/review-integration/v1/fixtures/status-v2-final-verification-retry.fixture.json": "40e99fd919ca80c9cbccd29143c4501348d7173b9596c97361167528455607a8",
	"tests/fixtures/review-integration/v1/fixtures/status-v2-recover.fixture.json": "5c5d5a8448368ecde35af464cf2cfef42d83d649903e97972364ce05d55327fb",
	"tests/fixtures/review-integration/v1/fixtures/status-v2-repair.fixture.json": "8ea4b3c97271d5dfe35efda7f1a4fae8af43000e14dd418d3dc8486968cb4139",
	"tests/fixtures/review-integration/v1/fixtures/status-v2-unrelated.fixture.json": "d663ec67abe7916ac1b37624ecd61affde3529ae6add49ccdbdecb927491fd73",
	"tests/fixtures/review-integration/v1/fixtures/status-v2.fixture.json": "4fa38b4427359c86bda198809f63cc5d6af7a8c3c8e7ab0e23cafe02432a4b9c",
	"tests/fixtures/review-integration/v1/fixtures/status.fixture.json": "93ba279948f83a2414a5547da76bc80beca34cae97555cfe8c5951ab864a7a20",
	"tests/fixtures/review-integration/v1/fixtures/verification-evidence.fixture.json": "627201e7d41a6dc81adfd660ffc6092a77e85d87888c86a232bdd8e8616bb17f",
	"tests/fixtures/review-integration/v1/schemas/admitted-result.schema.json": "317290e89385e0da0eca019f7f0aec5c52d7829d2dedc1777ea8a67318f0b45d",
	"tests/fixtures/review-integration/v1/schemas/artifact-subject.schema.json": "f6015db50b6f36491d92313897a6a88a5367feb07be5a38fad7db2d4df6f1ffb",
	"tests/fixtures/review-integration/v1/schemas/authority-repair-assessment.schema.json": "adc65f73d8d100148ff91d4b7d03d36a924e4b7190a72050ce06775f2381ab7f",
	"tests/fixtures/review-integration/v1/schemas/capabilities-v1.1.schema.json": "eb206d8e4b68f387200689dbe2b175f9aeb5ab49527e6ae14591aa01417da0b3",
	"tests/fixtures/review-integration/v1/schemas/capabilities-v1.2.schema.json": "954bf03f51ce57fdf4acde5bd1cf27da79e9ee8724701055fb9341caadc6f8b1",
	"tests/fixtures/review-integration/v1/schemas/capabilities-v1.3.schema.json": "09a8dadebb4dacb412b33a5fa1debd51fc9500a2dec14753b1a71dc3f57ab192",
	"tests/fixtures/review-integration/v1/schemas/capabilities-v1.4.schema.json": "1b656b4656a0ce3103cc3ed3a9825711dce9098c245d346ee828d6714abd183d",
	"tests/fixtures/review-integration/v1/schemas/capabilities-v1.5.schema.json": "820fca54c124b8d01384ecb2ed2d96d92f7d4249965e3b139493671d4fb6e807",
	"tests/fixtures/review-integration/v1/schemas/capabilities.schema.json": "687802838ba2fcc1ef876c5d3a6e767e237b0db19e92382d79ae77db7f0e13a9",
	"tests/fixtures/review-integration/v1/schemas/consent.schema.json": "5ce936d8ae86d81840e096e35628f62c02082dec1d264af56447bcb41bb9a53b",
	"tests/fixtures/review-integration/v1/schemas/correction-plan-request.schema.json": "f177fd9c79f0357a315e8865da7f10adf81a889ff75978ea4677564481e46a47",
	"tests/fixtures/review-integration/v1/schemas/failure.schema.json": "7dbdd8807f0b953929519ad0388a04a669eecf8b7afcab1b0cc500d690138203",
	"tests/fixtures/review-integration/v1/schemas/final-verification-incident.schema.json": "12d582c49d9aea4e056deba9414d3e1ffc4c028884c365e866b3b390cc404699",
	"tests/fixtures/review-integration/v1/schemas/operation.schema.json": "a33dc409aeb65be3a65a1f2fc4027dc9886423bba27e33d041c77e893cc8d1e7",
	"tests/fixtures/review-integration/v1/schemas/projection.schema.json": "5618bb82002bd471c11b1659e6ebe198b8f0902fb508186c0d51772bc3426b71",
	"tests/fixtures/review-integration/v1/schemas/repair.schema.json": "f3892e1e4de82a0bd1e868401d3a09aac40b05b5a07948b44b7d839194de4d34",
	"tests/fixtures/review-integration/v1/schemas/result-artifact-v2.schema.json": "4cb360281412ca2aa35a72439462a0100d107eed11883fefc9cabff3ea7ee6e2",
	"tests/fixtures/review-integration/v1/schemas/result-artifact.schema.json": "aa2592e70ba45e1bbb1daf92e9b8bd7dda9c9d7bf6e9df3a80125daa935bd251",
	"tests/fixtures/review-integration/v1/schemas/start-v2.schema.json": "8b9585896e16a7c16dcc63b64e912ac22bfb92631a134a2e4d6a543d9a52d418",
	"tests/fixtures/review-integration/v1/schemas/start.schema.json": "28bedf4887984bae41d1f2bfde4ab92d8e3d310df37df5bcb4516da500ea9ece",
	"tests/fixtures/review-integration/v1/schemas/status-v2.schema.json": "58b8d4da0eef132de0a9cc43880bee35fd7744fb4f7c7a02cff62c0ab5a97e10",
	"tests/fixtures/review-integration/v1/schemas/status.schema.json": "9944232e2fb33e77f174e7006159a18f33a0b60ea23718cef369b15f2aacec10",
	"tests/fixtures/review-integration/v1/schemas/targeted-validation-request.schema.json": "cd73f80be69a4ae0df20d4f7e7d0aec8c91275e2d1ad74551988d9fddfdccf5c",
	"tests/fixtures/review-integration/v1/schemas/transition-execution.schema.json": "726a9e37e14c0817fd9425cd06f2494d764e033638d43af541788741da831531",
	"tests/fixtures/review-integration/v1/schemas/verification-evidence.schema.json": "cc0ed7718ae1474ff4b3529e86f15f55288aaaee0c67205abe5a185d5bfd0c50",
	"tests/fixtures/review-integration/v2/fixtures/capabilities.fixture.json": "cdba4faaf6b62cf1cfe8be8cee8b87435a5729577477f301b9222ee9d6375422",
	"tests/fixtures/review-integration/v2/fixtures/consent.fixture.json": "0a8ec7e68610b2c2e4efdf3ad002fe503059d6e283c00168f67e0a147be9b548",
	"tests/fixtures/review-integration/v2/fixtures/start.fixture.json": "f9b08cf280a7864ffa17257c1d373d64c555d4b4efc6d2f0d509962ec8a138d0",
	"tests/fixtures/review-integration/v2/fixtures/status.fixture.json": "aadd103f397cab22db0ab1a5e01ad84c2fa8e90e70153d0cdc1b3bb4cf384749",
	"tests/fixtures/review-integration/v2/schemas/admitted-result.schema.json": "711de14810dfd61ca419241ab76c33bc95b006b78ebd94ad42759270a8cd0c36",
	"tests/fixtures/review-integration/v2/schemas/artifact-subject.schema.json": "2914221824e5a6a40a747ff5ff61642c3b9371dae45b3a5ddef145f13df7108b",
	"tests/fixtures/review-integration/v2/schemas/capabilities.schema.json": "03d4cd6ca1fff538421e874a62afb04da25ec2bbcc66f36903b82e92ba0a6dad",
	"tests/fixtures/review-integration/v2/schemas/consent.schema.json": "399969e8ea2c27d99d756960c3a9dc501098a56617092bb333901b4b533929a9",
	"tests/fixtures/review-integration/v2/schemas/failure.schema.json": "a3a7b6302f0bc0b79fecbe6e05c06caafcdbafa5aaa41c01a448731e883a292e",
	"tests/fixtures/review-integration/v2/schemas/last-event-closure.schema.json": "b2f1c4c6306a66ee6c3e65ca888b7f01476955898d7e71fc34a3c77a8abc8050",
	"tests/fixtures/review-integration/v2/schemas/opencode-provider-role.schema.json": "0f2ecee7dfa0576acca0b04106a94ed66836170c6ce8564958587f68e8fca2ba",
	"tests/fixtures/review-integration/v2/schemas/operation.schema.json": "d9c4e91c75e0ce634cc4b1fb6b97d209f2ab643ad0f9318baa0d00522a9425fe",
	"tests/fixtures/review-integration/v2/schemas/repair.schema.json": "1ed1033abc3c077b049f89bb09c7ac2ac6f7928a873f47eade00ad688d908196",
	"tests/fixtures/review-integration/v2/schemas/start.schema.json": "702828c818735e8bd4f460d1f58df87f55d71eb8fbb1a97c85a7ae169b4c156d",
	"tests/fixtures/review-integration/v2/schemas/status.schema.json": "9d85bde926b489a6b22ebbd870c1059008699aeff9fd15b7ce3a402b3489e294",
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
