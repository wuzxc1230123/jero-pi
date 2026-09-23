// 启动横幅统计探测：intro 模式选择、SDD 代理计数、包扩展计数与 git 分支读取。
// 自 extensions/startup-banner.ts 拆分（机械平移，语义零改动）。

import { execFile } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { PI_AGENT_DIR, PI_NPM_DIR } from "./banner-config.ts";
const FULL_INTRO_MIN_ROWS = 30;
const FULL_INTRO_MIN_COLS = 80;
const MINIMAL_INTRO_MIN_ROWS = 20;
const MINIMAL_INTRO_MIN_COLS = 40;
export const RESIZE_DEBOUNCE_MS = 150;
export const RESIZE_GRACE_PERIOD_MS = 300;

export type IntroMode = "full" | "minimal" | "skip";

function pickIntroMode(rows: number, cols: number): IntroMode {
  if (rows >= FULL_INTRO_MIN_ROWS && cols >= FULL_INTRO_MIN_COLS) return "full";
  if (rows >= MINIMAL_INTRO_MIN_ROWS && cols >= MINIMAL_INTRO_MIN_COLS) return "minimal";
  return "skip";
}

export function currentIntroMode(): IntroMode {
  // process.stdout.rows/columns 反映的是本进程 TTY 的真实尺寸；
  // TUI 的 render(width) 不暴露高度，所以这里直接读取。
  const rows = process.stdout.rows ?? 0;
  const cols = process.stdout.columns ?? 0;
  return pickIntroMode(rows, cols);
}

export async function countSddAgents(): Promise<number> {
  try {
    const entries = await readdir(join(PI_AGENT_DIR, "agents"), { withFileTypes: true });
    return entries.filter((entry) => entry.isFile() && /^sdd-.*\.md$/.test(entry.name)).length;
  } catch {
    return 0;
  }
}

function packageNameFromSpec(spec: unknown): string | undefined {
  if (typeof spec !== "string") return undefined;
  const clean = spec.replace(/^npm:/, "");
  if (clean.startsWith("@")) {
    const parts = clean.split("@");
    return parts.length > 2 ? `@${parts[1]}` : clean;
  }
  return clean.split("@")[0] || undefined;
}

export async function countPackageExtensions(packages: unknown[]): Promise<number> {
  let count = 0;
  for (const spec of packages) {
    const name = packageNameFromSpec(spec);
    if (!name) continue;
    try {
      const raw = await readFile(join(PI_NPM_DIR, name, "package.json"), "utf8");
      const pkg = JSON.parse(raw);
      const extensions = pkg?.pi?.extensions;
      if (Array.isArray(extensions)) count += extensions.length;
    } catch {
      // 从非 npm 来源安装的包可能不在 PI_NPM_DIR 中。
    }
  }
  return count;
}

export function readGitBranch(cwd: string, run: typeof execFile = execFile): Promise<string> {
  return new Promise((resolve) => {
    run("git", ["-C", cwd, "branch", "--show-current"], {
      encoding: "utf8",
      shell: false,
      windowsHide: true,
    }, (error, stdout) => {
      if (error) {
        resolve("Not a git repo");
        return;
      }
      const branch = String(stdout).trim();
      resolve(branch ? `On branch ${branch}` : "Detached HEAD");
    });
  });
}
