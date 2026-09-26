// 启动横幅扩展主体：默认导出的动画编排、渲染循环与命令注册。
// 配置/调色板、logo 模型与统计探测已拆至 lib/banner-*。
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { VERSION } from "@earendil-works/pi-coding-agent";
import { truncateToWidth } from "@earendil-works/pi-tui";
import * as os from "node:os";
import { execFile } from "node:child_process";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

export default function (pi: ExtensionAPI) {
	let disposeHeader = () => {};
	pi.on("session_shutdown", () => disposeHeader());
	const notifyBannerConfig = (ctx: any, config: BannerConfig) => {
		ctx.ui.notify(
			[
				`Startup banner: rose=${config.showRose ? "on" : "off"}, text logo=${config.showTextLogo ? "on" : "off"}, color=${config.color}`,
				`Config: ${bannerConfigPath()}`,
				"Changes apply on the next startup banner render.",
			].join("\n"),
			"info",
		);
	};

	const registerBannerCommand = (name: string) => {
		pi.registerCommand(name, {
			description: "Configure the Jero Pi startup banner.",
			handler: async (_args, ctx) => {
				const config = await readBannerConfig();
				const selected = await ctx.ui.select("Startup banner", [
					`Rose: ${config.showRose ? "on" : "off"}`,
					`Text logo: ${config.showTextLogo ? "on" : "off"}`,
					`Color: ${config.color}`,
				]);
				if (!selected) return;
				if (selected.startsWith("Rose:")) config.showRose = !config.showRose;
				else if (selected.startsWith("Text logo:")) config.showTextLogo = !config.showTextLogo;
				else if (selected.startsWith("Color:")) {
					const color = await ctx.ui.select("Startup banner color", [...BANNER_COLORS]);
					if (!color) return;
					config.color = color as BannerColor;
				}
				await writeBannerConfig(config);
				notifyBannerConfig(ctx, config);
			},
		});
	};
	const registerToggleCommand = (name: string, key: "showRose" | "showTextLogo") => {
		pi.registerCommand(name, {
			description: `Toggle startup banner ${key === "showRose" ? "rose" : "text logo"}.`,
			handler: async (_args, ctx) => {
				const config = await readBannerConfig();
				config[key] = !config[key];
				await writeBannerConfig(config);
				notifyBannerConfig(ctx, config);
			},
		});
	};
	const registerColorCommand = (name: string) => {
		pi.registerCommand(name, {
			description: "Set startup banner color preset.",
			handler: async (args, ctx) => {
				const config = await readBannerConfig();
				const requested = String(args ?? "").trim() as BannerColor;
				if (BANNER_COLORS.includes(requested)) {
					config.color = requested;
				} else {
					const selected = await ctx.ui.select("Startup banner color", [...BANNER_COLORS]);
					if (!selected) return;
					config.color = selected as BannerColor;
				}
				await writeBannerConfig(config);
				notifyBannerConfig(ctx, config);
			},
		});
	};
	registerBannerCommand("jero:banner");
	registerToggleCommand("jero:toggle-rose", "showRose");
	registerToggleCommand("jero:toggle-text-logo", "showTextLogo");
	registerColorCommand("jero:banner-color");

	pi.on("session_start", async (_event, ctx) => {
		disposeHeader();
		if (!ctx.hasUI) return;

		// 若正在执行 CLI 命令（如 "pi update" 或 "pi install"），则不播放动画开场。
		const isCLICommand =
			process.argv.length > 2 &&
			!process.argv.every((arg) => arg.startsWith("-") || arg.endsWith(".ts"));
		if (isCLICommand) return;

		if (currentIntroMode() === "skip") return;

		// Pi 已经启动了它的渲染器。让 setHeader 去安排绘制；
		// 在这里清空 stdout 会使其上一帧缓存失去同步。
		const bannerConfig = await readBannerConfig();
		const palette = BANNER_PALETTES[bannerConfig.color];
		const roseBase = padLines(normalizeAscii(ROSE_LARGE_RAW));
		const logoBase = padLines(TEXT_LOGO);
		void warmupLetterStrokes();

		let gitBranch = "Not a git repo";
		let mcpServersCount = 0;
		let extensionsCount = 0;
		let packagesCount = 0;
		let sddAgentsCount = 0;

		const allCommands = pi.getCommands();
		const skills = allCommands.filter((c) => c.source === "skill");
		const allTools = pi.getAllTools();
		const customTools = allTools.filter(
			(t) => !["builtin", "sdk"].includes(t.sourceInfo.source),
		);

		setTimeout(() => {
			readGitBranch(ctx.cwd)
				.then((branch) => { gitBranch = branch; })
				.finally(() => refreshStats());
		}, 100);

		setTimeout(() => {
			(async () => {
				try {
					const raw = await readFile(
						join(os.homedir(), ".pi", "agent", "mcp.json"),
						"utf8",
					);
					const cfg = JSON.parse(raw);
					mcpServersCount = Object.keys(cfg.mcpServers || {}).length;
				} catch {
					mcpServersCount = 0;
				}
				refreshStats();
			})();
		}, 150);

		setTimeout(() => {
			(async () => {
				try {
					sddAgentsCount = await countSddAgents();
					const raw = await readFile(
						join(PI_AGENT_DIR, "settings.json"),
						"utf8",
					);
					const cfg = JSON.parse(raw);
					const packages = Array.isArray(cfg.packages) ? cfg.packages : [];
					packagesCount = packages.length;
					extensionsCount = await countPackageExtensions(packages);
				} catch {
					extensionsCount = 0;
					packagesCount = 0;
				}
				refreshStats();
			})();
		}, 200);

		let tick = 0;
		let refreshStats = () => {};
		const state = {
			timer: null as NodeJS.Timeout | null,
			mode: currentIntroMode() as IntroMode,
			resizeHandler: null as (() => void) | null,
			resizeDebounceTimer: null as NodeJS.Timeout | null,
		};

		const cleanup = () => {
			refreshStats = () => {};
			if (state.timer) {
				clearInterval(state.timer);
				state.timer = null;
			}
			if (state.resizeHandler) {
				process.stdout.off("resize", state.resizeHandler);
				state.resizeHandler = null;
			}
			if (state.resizeDebounceTimer) {
				clearTimeout(state.resizeDebounceTimer);
				state.resizeDebounceTimer = null;
			}
		};

		disposeHeader = cleanup;
		setTimeout(() => {
			ctx.ui.setHeader((tui, theme) => {
				// 工厂重入防护：旧的 interval 与 resize 监听都必须摘除，
				// 否则重复进入会累积 stdout 监听器（引用已 dispose 的 tui）。
				if (state.timer) clearInterval(state.timer);
				if (state.resizeHandler) {
					process.stdout.off("resize", state.resizeHandler);
					state.resizeHandler = null;
				}
				if (state.resizeDebounceTimer) {
					clearTimeout(state.resizeDebounceTimer);
					state.resizeDebounceTimer = null;
				}

				refreshStats = () => tui.requestRender();
				const animStart = Date.now();
				state.timer = setInterval(() => {
					tick++;
					const finished = allStrokesReady() && tick > WRITING_END_TICK + 22;
					if (finished || Date.now() - animStart > 5000) {
						clearInterval(state.timer!);
						state.timer = null;
					}
					try { tui.requestRender(); } catch { cleanup(); }
				}, 25);

				// 宽限期：pi-tui 在组合初始布局时会发出瞬时的 resize 事件。
				const bootStart = Date.now();
				const resizeHandler = () => {
					if (Date.now() - bootStart < RESIZE_GRACE_PERIOD_MS) return;
					if (state.resizeDebounceTimer) clearTimeout(state.resizeDebounceTimer);
					state.resizeDebounceTimer = setTimeout(() => {
						state.resizeDebounceTimer = null;
						const next = currentIntroMode();
						if (next === state.mode) return;
						state.mode = next;
						// skip 模式下由 Pi 负责移除；继续监听以便后续窗口放大。
						try {
							tui.requestRender();
						} catch {
							cleanup();
						}
					}, RESIZE_DEBOUNCE_MS);
				};
				state.resizeHandler = resizeHandler;
				process.stdout.on("resize", resizeHandler);

				return {
					render(width: number): string[] {
						if (state.mode === "skip") return [];

						const flashStartTick = 10;
						const roseOpacity = Math.min(1, tick / 10);
						const flashPhase =
							tick >= flashStartTick
								? Math.max(0, 1 - (tick - flashStartTick) / 12)
								: 0;
						const frame = Math.floor(tick / 2);

						const sideBySideMinWidth = roseBase.width + 3 + logoBase.width + 4;
						const horizontal =
							state.mode === "full" && bannerConfig.showRose && bannerConfig.showTextLogo && width >= sideBySideMinWidth;
						const wideStatsMinWidth = 122;
						const wideStats = width >= wideStatsMinWidth;

						const b = new LayoutBuilder();
						b.addRow();
						b.center(width);

						if (state.mode === "minimal") {
							if (bannerConfig.showTextLogo) for (let logoI = 0; logoI < logoBase.lines.length; logoI++) {
								const logoLine = logoBase.lines[logoI];
								b.addRow();
								b.lines[b.lines.length - 1].push(
									...buildPenLogoLine(logoLine, logoI, logoBase.lines.length, tick),
								);
								b.center(width);
							}
						} else if (horizontal) {
							const rowCount = Math.max(roseBase.lines.length, logoBase.lines.length);
							const roseOffset = Math.max(0, Math.floor((rowCount - roseBase.lines.length) / 2));
							const logoOffset = Math.max(0, Math.floor((rowCount - logoBase.lines.length) / 2));
							for (let i = 0; i < rowCount; i++) {
								const roseI = i - roseOffset;
								const logoI = i - logoOffset;
								const roseLine = roseI >= 0 && roseI < roseBase.lines.length
									? roseBase.lines[roseI] : " ".repeat(roseBase.width);
								const logoLine = logoI >= 0 && logoI < logoBase.lines.length
									? logoBase.lines[logoI] : " ".repeat(logoBase.width);
								b.addRow();
								b.add("rose", roseLine);
								b.add("none", "   ");
								if (logoI >= 0 && logoI < logoBase.lines.length) {
									b.lines[b.lines.length - 1].push(
										...buildPenLogoLine(logoLine, logoI, logoBase.lines.length, tick),
									);
								} else {
									b.add("none", " ".repeat(logoBase.width));
								}
								b.center(width);
							}
						} else {
							const showBanner = bannerConfig.showTextLogo && width >= logoBase.width + 2;
							const showRose = bannerConfig.showRose && width >= roseBase.width + 2;
							if (showBanner) {
								for (let logoI = 0; logoI < logoBase.lines.length; logoI++) {
									const logoLine = logoBase.lines[logoI];
									b.addRow();
									b.lines[b.lines.length - 1].push(
										...buildPenLogoLine(logoLine, logoI, logoBase.lines.length, tick),
									);
									b.center(width);
								}
								if (showRose) {
									b.addRow();
									b.center(width);
								}
							}
							if (showRose) {
								for (const roseLine of roseBase.lines) {
									b.addRow();
									b.add("rose", roseLine);
									b.center(width);
								}
							}
						}

						if (state.mode === "full" || (!bannerConfig.showRose && !bannerConfig.showTextLogo)) {
							b.addRow();
							b.center(width);

							const fit = (v: unknown, w: number) =>
								String(v ?? "")
									.replace(/\s+/g, " ")
									.trim()
									.slice(0, w)
									.padEnd(w);
							const addWideRow = (
								l1: string,
								v1: string,
								l2: string,
								v2: string,
							) => {
								b.addRow();
								b.add("label", fit(l1, 10));
								b.add("none", " ");
								b.add("value", fit(v1, 48));
								b.add("none", "   ");
								b.add("label", fit(l2, 12));
								b.add("none", " ");
								b.add("value", fit(v2, 46));
								b.center(width);
							};
							const narrowRows: Array<[string, string]> = [
								["GIT:", gitBranch],
								["PATH:", ctx.cwd],
								["MCP:", `${mcpServersCount} server(s)`],
								["AGENTS:", `${sddAgentsCount} phases`],
								["PLUGINS:", `${packagesCount} package(s)`],
								["SKILLS:", `${skills.length} loaded`],
								["EXTENSIONS:", `${extensionsCount} active`],
								["VER:", `v${VERSION}`],
								["TOOLS:", `${customTools.length} custom`],
							];
							const narrowLabelW = Math.max(...narrowRows.map(([l]) => l.length));
							const narrowValueW = Math.max(
								0,
								Math.min(
									Math.max(...narrowRows.map(([, v]) => v.length)),
									Math.max(8, width - narrowLabelW - 4),
								),
							);
							const addNarrowRow = (label: string, value: string) => {
								b.addRow();
								b.add("label", label.padEnd(narrowLabelW));
								b.add("none", "  ");
								b.add("value", fit(value, narrowValueW));
								b.center(width);
							};

							if (wideStats) {
								addWideRow("GIT:", gitBranch, "PATH:", ctx.cwd);
								addWideRow(
									"MCP:",
									`${mcpServersCount} server(s)`,
									"PLUGINS:",
									`${packagesCount} package(s)`,
								);
								addWideRow(
									"AGENTS:",
									`${sddAgentsCount} phases`,
									"EXTENSIONS:",
									`${extensionsCount} active`,
								);
								addWideRow(
									"SKILLS:",
									`${skills.length} loaded`,
									"TOOLS:",
									`${customTools.length} custom`,
								);
								addWideRow("VER:", `v${VERSION}`, "", "");
							} else {
								addNarrowRow("GIT:", gitBranch);
								addNarrowRow("PATH:", ctx.cwd);
								addNarrowRow("MCP:", `${mcpServersCount} server(s)`);
								addNarrowRow("PLUGINS:", `${packagesCount} package(s)`);
								addNarrowRow("AGENTS:", `${sddAgentsCount} phases`);
								addNarrowRow("SKILLS:", `${skills.length} loaded`);
								addNarrowRow("EXTENSIONS:", `${extensionsCount} active`);
								addNarrowRow("VER:", `v${VERSION}`);
								addNarrowRow("TOOLS:", `${customTools.length} custom`);
							}

							b.addRow();
							b.center(width);
						}

						const out: string[] = [];
						const layout = b.lines;

						const logoRows = layout
							.map((row, idx) => ({
								idx,
								hasLogo: (row || []).some((c) => isLogoCellType(c.type)),
							}))
							.filter((r) => r.hasLogo)
							.map((r) => r.idx);
						const sparkleY =
							logoRows.length > 0
								? logoRows[Math.floor(logoRows.length / 2)]
								: -1;
						const logoLastX = Math.max(
							-1,
							...layout.map((row) => {
								let last = -1;
								for (let i = 0; i < (row || []).length; i++) {
									const cell = row?.[i];
									if (cell && isLogoCellType(cell.type) && cell.char !== " ") {
										last = i;
									}
								}
								return last;
							}),
						);

						const glintStartTick = WRITING_END_TICK + 3;
						const glintEndTick = WRITING_END_TICK + 12;
						const glintActive = tick >= glintStartTick && tick <= glintEndTick;
						const glintHead =
							((tick - glintStartTick) /
								Math.max(1, glintEndTick - glintStartTick)) *
							(LOGO_BOUNDS.end - LOGO_BOUNDS.start + 1);
						const sparkleActive =
							tick >= WRITING_END_TICK + 13 && tick <= WRITING_END_TICK + 20;

						for (let y = 0; y < layout.length; y++) {
							const row = layout[y] || [];
							const firstLogoX = row.findIndex(
								(c) => isLogoCellType(c.type) && c.char !== " ",
							);
							let line = "";

							for (let x = 0; x < row.length; x++) {
								const cell = row[x] || { char: " ", type: "none" as const };
								if (cell.char === " ") {
									line += " ";
									continue;
								}

								if (cell.type === "rose") {
									const pulse = 0.9 + Math.sin((x + y + frame) * 0.08) * 0.1;
									const k = Math.max(0.01, roseOpacity * pulse);
									const f = flashPhase ** 0.4;

									const rBase = Math.floor(palette.rose[0] * k);
									const gBase = Math.floor(palette.rose[1] * k);
									const bBase = Math.floor(palette.rose[2] * k);

									if (f > 0.85) {
										line += `\x1b[1m\x1b[38;2;255;255;255m${cell.char}\x1b[0m`;
									} else {
										const r = Math.floor(rBase + (255 - rBase) * f);
										const g = Math.floor(gBase + (255 - gBase) * f);
										const bColor = Math.floor(bBase + (255 - bBase) * f);
										line += rgb(r, g, bColor, cell.char);
									}
									continue;
								}

								if (isLogoCellType(cell.type)) {
									const localLogoX = firstLogoX >= 0 ? x - firstLogoX : x;
									const glintOnCell =
										glintActive &&
										localLogoX >= glintHead - 2 &&
										localLogoX <= glintHead + 1;
									const sparkleOnCell =
										sparkleActive &&
										y === sparkleY &&
										(x === logoLastX || x === logoLastX - 1);

									if (sparkleOnCell) {
										line += `\x1b[1m` + rgb(255, 255, 255, "✦") + `\x1b[22m`;
										continue;
									}

									if (glintOnCell) {
										line += `\x1b[1m` + rgb(255, 245, 252, cell.char) + `\x1b[22m`;
										continue;
									}

									if (cell.type === "logo-tip") {
										line += `\x1b[1m` + rgb(255, 205, 238, cell.char) + `\x1b[22m`;
									} else if (cell.type === "logo-fresh") {
										line += cell.char === "▒"
											? paletteColor(bannerConfig.color, "logoDim", cell.char)
											: paletteColor(bannerConfig.color, "logoFresh", cell.char);
									} else {
										line += cell.char === "▒"
											? paletteColor(bannerConfig.color, "logoDim", cell.char)
											: paletteColor(bannerConfig.color, "value", cell.char);
									}
									continue;
								}

								switch (cell.type) {
									case "label":
										line += paletteColor(bannerConfig.color, "label", cell.char);
										break;
									case "value":
										line += paletteColor(bannerConfig.color, "value", cell.char);
										break;
									case "dim":
										line += theme.fg("dim", cell.char);
										break;
									case "accent":
										line += theme.fg("accent", cell.char);
										break;
									default:
										line += cell.char;
								}
							}

							out.push(truncateToWidth(line, Math.max(1, width), ""));
						}

						return out;
					},
					invalidate() {},
					dispose() {
						cleanup();
					},
				};
			});
		}, 50);
	});
}

import {
	BANNER_COLORS, BANNER_PALETTES, type BannerColor, type BannerConfig, bannerConfigPath,
	normalizeAscii, padLines, paletteColor, PI_AGENT_DIR, readBannerConfig, rgb, ROSE_LARGE_RAW,
	TEXT_LOGO, writeBannerConfig
} from "../lib/banner-config.ts";
import {
	allStrokesReady, buildPenLogoLine, isLogoCellType, LayoutBuilder, LOGO_BOUNDS,
	warmupLetterStrokes, WRITING_END_TICK
} from "../lib/banner-logo-model.ts";
import {
	countPackageExtensions, countSddAgents, currentIntroMode, type IntroMode, readGitBranch,
	RESIZE_DEBOUNCE_MS, RESIZE_GRACE_PERIOD_MS
} from "../lib/banner-stats.ts";

export * from "../lib/banner-config.ts";
export * from "../lib/banner-logo-model.ts";
export * from "../lib/banner-stats.ts";
