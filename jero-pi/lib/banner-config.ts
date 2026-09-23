// 启动横幅配置：agent 目录、banner 配置读写、调色板与 ASCII 归一化/填充助手。
// 自 extensions/startup-banner.ts 拆分（机械平移，语义零改动）。

import * as os from "node:os";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
export const PI_AGENT_DIR = join(os.homedir(), ".pi", "agent");
export const PI_NPM_DIR = join(PI_AGENT_DIR, "npm", "node_modules");

export type BannerColor = "pink" | "cyan" | "yellow" | "green";
export interface BannerConfig {
  showRose: boolean;
  showTextLogo: boolean;
  color: BannerColor;
}
const DEFAULT_BANNER_CONFIG: BannerConfig = {
  showRose: true,
  showTextLogo: true,
  color: "pink",
};
export const BANNER_COLORS: BannerColor[] = ["pink", "cyan", "yellow", "green"];
export const BANNER_PALETTES: Record<BannerColor, { rose: [number, number, number]; label: [number, number, number]; value: [number, number, number]; logoFresh: [number, number, number]; logoDim: [number, number, number] }> = {
  pink: { rose: [255, 118, 195], label: [200, 100, 160], value: [255, 140, 210], logoFresh: [255, 138, 206], logoDim: [95, 30, 60] },
  cyan: { rose: [95, 210, 255], label: [85, 170, 205], value: [130, 225, 255], logoFresh: [105, 220, 255], logoDim: [25, 80, 100] },
  yellow: { rose: [255, 210, 95], label: [210, 165, 65], value: [255, 225, 135], logoFresh: [255, 215, 105], logoDim: [105, 75, 25] },
  green: { rose: [110, 220, 145], label: [85, 175, 115], value: [145, 240, 170], logoFresh: [120, 230, 150], logoDim: [30, 95, 50] },
};

export const TEXT_LOGO = [
  "                  ▄▄▄▀▀▀▀▀██                                ▄▄▀▄▄           ▄▄█▀▀▀██   ▀▀█▄    ▄▄▄",
  "              ▄▄█▀▀▒▒▒▒▒▄▄█▀▒                   ▄██     ▄▄█▀█▄█▀▒▒      ▄█▀▀ ▒▒▒▄█▀▀▒   ▄██▒ ▄█▀▒▒▒",
  "          ▄▄██▀▒▒▒▒▒▄▄▄▀▀▒▒▒▒        ▄▄▄  ▀▀▀▀██▀▀▀▀▀███▀█▄▀▀▒▒▒▒      ██▒▒▒▒▄▄█▀▒▒▒▒▄▄█▀▀▄██▀▒▒▒",
  "        ▄██▀▒▒▒▒     ▒▒▄▄█ ▄▄▄▀██ ▄▄▄▀▀▀▄  ▄██▀▒▒▒▒▄██▀▀▀▒▄▄███         ▒▒ ▄███▄▄▄█▀▀▀▒▒▄██▀▒▒▒",
  "       ██▀▒▒▒     ▄▄▄███▀▄██▀▀▀▄▄██▀▀▄█▀▄▄██▀▒▒▒▄▄██▀▒▒▄██▀▀▀▄▄▀▀▀▀▀▀▀▀▀ ▄█▀▀▒▒▒▒▒▒▒▒▒▄██▒▒▒▒",
  "       ▀█▄▄▄▄▄▀▀▀█▄▄███▄▒▀▀▀▀▀▀▒▀▀▒▒▀▀▀▀▒██▄▄▀▀▀ ▀█▄▀▀▀ ▀▀▀▀▀▒▒▒▒▒▒▒▒▒▒▄██▀▒▒▒       ███▒▒",
  "        ▒▄▄▄█▀▀▀█▄█▀▀▒▒▒▒ ▒▒▒▒▒▒ ▒▒  ▒▒▒▒ ▒▒▒▒▒▒▒ ▒▒▒▒▒▒ ▒▒▒▒▒        ▀▀▀▒▒▒          ▒▒▒",
  "     ▄▄▀▀ ▒▒▒▒▄██▀▒▒▒▒                                                 ▒▒▒",
  "   ▄█ ▒▒▒▄▄██▀▀▒▒▒▒",
  "    ▀▀▀▀▀▀▒▒▒▒▒▒",
  "     ▒▒▒▒▒▒",
];

export const ROSE_LARGE_RAW = [
  "             ⣠⣾⣷⣶⣦⣤⣤⣄⣠⣄⣀  ⢀⣀⣀",
  "          ⢀⣴⣿⣿⠿⣋⣭⣭⣯⣭⣍⣭⣿⣟⠛⠛⠿⣿⣷⣄",
  "      ⢀⣴⣾⡟⢻⣿⡟⠁⣼⣿⠏⣵⢻⣿⣻⣿⣿⢿⡻⣿⣿⣶⡌⢿⣿⣷⣦⣤⡄",
  "   ⣤⣶⣾⣿⣿⠏ ⠈⢿⣄ ⢹⣏⠠⠟⣾⣿⣿⣿⣿⣿⠷⣏⣼⠟⢡⣿⡟⠋⢻⣿⣿⡄",
  "   ⠈⣿⣿⣿⣿⡆   ⣽⢧⡘⠈⠳⣦⣍⠛⠛⢦⣉⣴⣛⣫⣭⣴⡟⠋  ⣾⣿⣿⡿",
  "   ⢀⠹⣿⣿⣿⣷⣤⡄ ⠋ ⠙⢆ ⣠⠴⠟⠛⣛⣛⣛⠟⠋⠁⠺⡇ ⣀⣴⣿⣿⡟⠁",
  "   ⠈⣀⠈⠛⠷⠿⣿⣿⣷⣤⣀ ⢠⠋   ⠈⠉⠉    ⣠⣴⣥⠾⠛⠉⣰⣿⣷",
  "          ⠹⣯⣝⠛⠛⠷⢶⣤⣤⣀   ⢀⡠⠖⠋⠉⢉⣀⣀⣴⣾⣿⠿⠟⠃",
  "             ⠘⠻⢿⣦⣄⡀  ⠉⠛⢦⠠⢊⠤⠴⢒⣛⣛⣩⣽⡿⠟⠁",
  "        ⠶⢶⣤⣄⡀⠨⠭⠽⠟⣓⢦⣀⠈⢇⡥⠖⠛⠋⠉⠉",
  "           ⠈⢷ ⠐⠂⢤⣽⣄ ⠰⡎⠙⠳⣄⡀ ⠈⢣⠘⢦⠋",
  "            ⠈⢳⣀⡒⠉⠉⣉⠙⡲⣽⣄ ⣏⠳⡄ ⠘⡇ ⡾⠁",
  "              ⠛⠻⢦⣄⣉⡁⣀⣀⣈⣙⣺⣌⡇⢠⢀⡇⡾",
  "                   ⠈⠉    ⠈⠳⡄⣸⢱⠇",
  "                           ⡷⠡⡯⢖⠉",
  "                        ⢀⡴⢪⠔⣉⠔⠋",
  "                           ⠐⠈",
];

export function rgb(r: number, g: number, b: number, text: string): string {
  return `\x1b[38;2;${r};${g};${b}m${text}\x1b[39m`;
}

function gentleAiConfigHome(): string {
  return process.env.JERO_PI_CONFIG_HOME ?? join(os.homedir(), ".pi", "jero");
}

export function bannerConfigPath(): string {
  return join(gentleAiConfigHome(), "banner.json");
}

function normalizeBannerConfig(value: unknown): BannerConfig {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return { ...DEFAULT_BANNER_CONFIG };
  const record = value as Record<string, unknown>;
  return {
    showRose: typeof record.showRose === "boolean" ? record.showRose : DEFAULT_BANNER_CONFIG.showRose,
    showTextLogo: typeof record.showTextLogo === "boolean" ? record.showTextLogo : DEFAULT_BANNER_CONFIG.showTextLogo,
    color: BANNER_COLORS.includes(record.color as BannerColor) ? record.color as BannerColor : DEFAULT_BANNER_CONFIG.color,
  };
}

export async function readBannerConfig(): Promise<BannerConfig> {
  try {
    return normalizeBannerConfig(JSON.parse(await readFile(bannerConfigPath(), "utf8")));
  } catch {
    return { ...DEFAULT_BANNER_CONFIG };
  }
}

export async function writeBannerConfig(config: BannerConfig): Promise<void> {
  const path = bannerConfigPath();
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, `${JSON.stringify(config, null, 2)}\n`, "utf8");
}

export function paletteColor(color: BannerColor, key: keyof typeof BANNER_PALETTES[BannerColor], text: string): string {
  const [r, g, b] = BANNER_PALETTES[color][key];
  return rgb(r, g, b, text);
}

export function normalizeAscii(lines: string[]): string[] {
  const trimmed = lines.map((l) => l.replace(/\s+$/g, ""));
  const nonEmpty = trimmed.filter((l) => l.trim().length > 0);
  const minLead = nonEmpty.length
    ? Math.min(...nonEmpty.map((l) => (l.match(/^\s*/) || [""])[0].length))
    : 0;
  return trimmed.map((l) => (l.length >= minLead ? l.slice(minLead) : l));
}

export function padLines(lines: string[]): { lines: string[]; width: number } {
  const width = Math.max(...lines.map((l) => l.length), 0);
  return { lines: lines.map((l) => l.padEnd(width)), width };
}
