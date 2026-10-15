// 束内内容机检的判定体（纯函数）：交接指针解析、技能/角色骨架同名、
// 入口指路、孤儿 references、清单手写计数。单一事实源——安装验证
// （verifyModule 的 bundle-content 检查项）、CI 库门（check-module-contract）
// 与库内容测试三方共用，判定永不漂移。不触 fs/process.env，文本由调用方读入。
import type { ModuleManifest } from "./module-contract.ts";

export interface BundleContentInput {
	readonly manifest: ModuleManifest;
	/** 知识入口全文；入口指路段在此文本上判定。 */
	readonly entryText: string;
	/** 技能目录名 → SKILL.md 全文（目录缺 SKILL.md 时调用方传空串——空文本会被同名检查响亮拒绝）。 */
	readonly skillTexts: Readonly<Record<string, string>>;
	/** 角色名 → 档案全文；缺省时跳过角色文本检查（文件存在性由库门/安装路径另行保证）。 */
	readonly agentTexts?: Readonly<Record<string, string>>;
	/** references/ 下文件名（去 .md）。 */
	readonly referenceNames: readonly string[];
	/** 宿主随包代理名（jero-worker 等）——交接块允许指向的束外真实名字。 */
	readonly hostAgentNames?: readonly string[];
}

export interface BundleContentFinding {
	/** 束内相对位置（skills/<x>/SKILL.md、agents/<x>.md、module.json 或入口路径）。 */
	readonly file: string;
	readonly message: string;
}

const HANDOFF_ANCHOR = /^> \*\*相关技能：\*\*/m;
/** 名字形态（小写词元/连字符）——只对这类交接 token 做解析判定，其余（`.godot/` 类行内代码）视为散文。 */
const NAME_LIKE = /^[a-z][a-z0-9-]+$/;
/** references 提及形态：文件名允许大写与点/连字符（与 references/ 真实文件名对齐）。 */
const REFERENCE_MENTION = /references\/([A-Za-z0-9_.-]+)\.md/g;

/** 交接块的完整文本：锚点到下一个 Markdown 标题为止（此前止于首个空行，
 * 块中段插一个空行就能让其后的悬空指针逃逸检查）。 */
function handoffBlockOf(text: string): string | undefined {
	const anchor = HANDOFF_ANCHOR.exec(text);
	if (anchor === null) return undefined;
	const rest = text.slice(anchor.index + anchor[0].length);
	const headingAt = rest.search(/\n#{1,6} /);
	return anchor[0] + (headingAt === -1 ? rest : rest.slice(0, headingAt));
}

/** 审计束内文本纪律；零发现 = 干净。发现的 file 前缀已含束内位置，可直接拼进检查详情。 */
export function auditBundleContent(input: BundleContentInput): BundleContentFinding[] {
	const { manifest } = input;
	const findings: BundleContentFinding[] = [];
	const skillNames = Object.keys(input.skillTexts).sort();
	const resolvable = new Set<string>([
		...skillNames,
		...manifest.roles.map((role) => role.name),
		...(input.hostAgentNames ?? []),
	]);
	const refSet = new Set(input.referenceNames);

	for (const skill of skillNames) {
		const file = `skills/${skill}/SKILL.md`;
		const text = input.skillTexts[skill] ?? "";
		const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)?.[1] ?? "";
		const name = /^name:\s*(.+)$/m.exec(frontmatter)?.[1]?.trim();
		if (name !== skill) findings.push({ file, message: `frontmatter name「${name}」≠ 目录名 ${skill}` });
		if (!/^description:\s*\S/m.test(frontmatter)) findings.push({ file, message: "缺 description" });
		const handoff = handoffBlockOf(text);
		if (handoff === undefined) {
			findings.push({ file, message: "缺「> **相关技能：**」交接块" });
		} else {
			for (const [, token] of handoff.matchAll(/`([^`]+)`/g)) {
				if (token.startsWith("references/")) {
					const stem = token.replace(/^references\//, "").replace(/\.md$/, "");
					if (!refSet.has(stem)) findings.push({ file, message: `交接指向的 ${token} 不存在` });
				} else if (NAME_LIKE.test(token) && !resolvable.has(token)) {
					findings.push({ file, message: `交接指针 \`${token}\` 悬空（非束内技能/角色/references，亦非宿主代理）` });
				}
			}
		}
		for (const [, ref] of text.matchAll(REFERENCE_MENTION)) {
			if (!refSet.has(ref)) findings.push({ file, message: `references/${ref}.md 不存在` });
		}
	}

	for (const role of manifest.roles) {
		const text = input.agentTexts?.[role.name];
		if (text === undefined) continue;
		const file = `agents/${role.name}.md`;
		const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)?.[1] ?? "";
		const name = /^name:\s*(.+)$/m.exec(frontmatter)?.[1]?.trim();
		if (name !== role.name) findings.push({ file, message: `frontmatter name「${name}」≠ 角色名 ${role.name}` });
		for (const [, ref] of text.matchAll(REFERENCE_MENTION)) {
			if (!refSet.has(ref)) findings.push({ file, message: `references/${ref}.md 不存在` });
		}
	}

	// 知识入口的指路段：反引号名紧跟「（」的形态必须是真实 reference。
	const guideSection = /## 知识指路[\s\S]*?(?=\n## )/.exec(input.entryText)?.[0] ?? "";
	for (const [, token] of guideSection.matchAll(/`([a-z0-9_-]+)`（/g)) {
		if (!refSet.has(token)) {
			findings.push({ file: manifest.knowledge.entry, message: `指路名 \`${token}\` 不是 references 下的文件` });
		}
	}

	// 反向孤儿：每个 reference 至少被入口或某个技能指路（L2 必须有指路）。
	// 整词判定：反引号包裹的裸名或完整 references/<name>.md 路径才算——
	// 此前的子串包含会把 `api` 算作被 `api-design` 指路。
	const allText = input.entryText + Object.values(input.skillTexts).join("");
	for (const ref of input.referenceNames) {
		if (!allText.includes(`\`${ref}\``) && !allText.includes(`references/${ref}.md`)) {
			findings.push({ file: "module.json", message: `孤儿 reference \`${ref}\`（入口与技能均无指路）` });
		}
	}

	// 清单 description 的手写计数（出现该形态才检查——手工模块措辞自由）。
	const description = manifest.description ?? "";
	const skillClaim = /(\d+) 个领域技能入口/.exec(description)?.[1];
	if (skillClaim !== undefined && Number(skillClaim) !== skillNames.length) {
		findings.push({ file: "module.json", message: `description 称 ${skillClaim} 技能，束内实为 ${skillNames.length}` });
	}
	const refClaim = /(\d+) 篇深知识/.exec(description)?.[1];
	// `_sources` 是出处账本（元），不是深知识篇目——description 的
	// "N 篇深知识"按内容篇计，账本另述。
	const deepKnowledgeCount = input.referenceNames.filter((name) => name !== "_sources").length;
	if (refClaim !== undefined && Number(refClaim) !== deepKnowledgeCount) {
		findings.push({ file: "module.json", message: `description 称 ${refClaim} 篇 references，束内实为 ${deepKnowledgeCount}` });
	}

	return findings;
}
