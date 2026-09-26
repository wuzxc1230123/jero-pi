import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
	closeSkillRegistryWatchers,
	ensureAtlIgnored,
	NO_SKILL_REGISTRY_FLAG,
	quarantineLegacyProjectRegistry,
	regenerateRegistry,
	shouldSkipDuplicateExtensionLoad,
	shouldSkipSkillRegistryStartup,
	startSkillRegistryWatcher,
} from "../lib/skill-registry-engine.ts";

// skill-registry 扩展：引擎（扫描/渲染/缓存/监视/legacy 隔离）在
// lib/skill-registry-engine.ts，这里只做生命周期装配与命令注册。
// 去重守卫必须传扩展自身的 import.meta.url——引擎侧若用默认参数，
// 其值会在 lib 模块内求值，指向 lib 文件会让"项目本副本胜出"的判定失效。

const WATCH_DEBOUNCE_MS = 500;
const REGISTRY_REL_PATH = ".atl/skill-registry.md";

export default function (pi: ExtensionAPI) {
	if (shouldSkipDuplicateExtensionLoad(import.meta.url)) return;

	pi.on("session_shutdown", () => {
		closeSkillRegistryWatchers();
	});

	pi.registerFlag(NO_SKILL_REGISTRY_FLAG, {
		description: "Skip the Jero skill registry refresh and watcher on startup.",
		type: "boolean",
		default: false,
	});

	pi.on("session_start", async (_event, ctx) => {
		if (shouldSkipSkillRegistryStartup(pi)) return;
		try {
			await ensureAtlIgnored(ctx.cwd);
			const quarantinedLegacy = await quarantineLegacyProjectRegistry(ctx.cwd);
			const result = await regenerateRegistry(ctx.cwd, quarantinedLegacy);
			if (result.regenerated && ctx.hasUI) {
				ctx.ui.notify(
					`Skill registry refreshed (${result.skillCount} skills)`,
					"info",
				);
			}
			if (quarantinedLegacy && ctx.hasUI) {
				ctx.ui.notify(
					"Disabled stale project-local skill registry extension; using package registry with project skills first.",
					"warning",
				);
			}
			if (ctx.hasUI) {
				await startSkillRegistryWatcher(ctx.cwd, (message) => {
					ctx.ui.notify(message, "info");
				});
			}
			if (quarantinedLegacy) {
				setTimeout(() => {
					void (async () => {
						try {
							await regenerateRegistry(ctx.cwd, true);
						} catch {
							// 尽力而为的同会话自愈，以防过期的扩展已经运行过。
						}
					})();
				}, WATCH_DEBOUNCE_MS);
			}
		} catch (error) {
			if (ctx.hasUI) {
				const message =
					error instanceof Error ? error.message : String(error);
				ctx.ui.notify(
					`Skill registry refresh failed: ${message}`,
					"warning",
				);
			}
		}
	});

	pi.registerCommand("skill-registry:refresh", {
		description: "Regenerate .atl/skill-registry.md from local skill sources.",
		handler: async (_args, ctx) => {
			try {
				await ensureAtlIgnored(ctx.cwd);
				const result = await regenerateRegistry(ctx.cwd, true);
				ctx.ui.notify(
					`Skill registry: ${result.skillCount} skill(s) written to ${REGISTRY_REL_PATH}`,
					"info",
				);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				ctx.ui.notify(`Skill registry refresh failed: ${message}`, "warning");
			}
		},
	});
}
