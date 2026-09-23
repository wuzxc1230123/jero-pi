import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { closeSync, fsyncSync, lstatSync, openSync, readFileSync, readdirSync, readlinkSync, realpathSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { conservativeOwnerDeathProofV1 } from "./review-lock.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const BOOT_UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
export interface CandidateViewOwner {
	version: 1;
	uuid: string;
	token: string;
	pid: number;
	host: string | null;
	root: string;
	commonDir: string;
}
type Git = (args: readonly string[]) => string;
export type WindowsAclAuthority = (path: string) => void;

let testingWindowsAclAuthority: WindowsAclAuthority | undefined;
export function setWindowsAclAuthorityForTesting(authority?: WindowsAclAuthority): void {
	testingWindowsAclAuthority = authority;
}

const WINDOWS_SYSTEM = "S-1-5-18";
const WINDOWS_ADMINISTRATORS = "S-1-5-32-544";
const WINDOWS_SYSTEM_DIRECTORY = "\\\\?\\GLOBALROOT\\SystemRoot\\System32";

// 构造子进程 env：先剔除 SystemRoot 的全部大小写变体再写入真实值。
// Windows 环境变量大小写不敏感——伪装测试对 process.env.SystemRoot 的
// 赋值可能在枚举快照里留下 SYSTEMROOT 等变体副本，单纯的
// { ...process.env, SystemRoot: real } 无法可靠覆盖，PowerShell 引擎
// 会因拿到伪装的 SystemRoot 启动失败（0x8009001d）。
function canonicalSystemRootEnv(systemRoot: string, extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
	const env: NodeJS.ProcessEnv = {};
	for (const [key, value] of Object.entries(process.env)) {
		if (key.toUpperCase() === "SYSTEMROOT") continue;
		env[key] = value;
	}
	env.SystemRoot = systemRoot;
	return { ...env, ...extra };
}

function windowsSystemExecutable(name: "whoami.exe" | "icacls.exe" | "WindowsPowerShell\\v1.0\\powershell.exe"): string {
	try {
		return realpathSync.native(join(WINDOWS_SYSTEM_DIRECTORY, name));
	} catch {
		throw new Error("Windows system executable is unavailable");
	}
}

const windowsUserSidMemo: { value?: string } = {};
function windowsUserSid(): string {
	if (windowsUserSidMemo.value !== undefined) return windowsUserSidMemo.value;
	const output = execFileSync(windowsSystemExecutable("whoami.exe"), ["/user", "/fo", "csv", "/nh"], { encoding: "utf8", timeout: 15000, maxBuffer: 4096, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
	const matches = output.match(/S-\d+(?:-\d+)+/gi) ?? [];
	if (matches.length !== 1) throw new Error("Windows user SID is unavailable");
	return (windowsUserSidMemo.value = matches[0]!.toUpperCase());
}

const windowsLocalAdministratorSidMemo: { value?: string } = {};
function windowsLocalAdministratorSid(): string {
	if (windowsLocalAdministratorSidMemo.value !== undefined) return windowsLocalAdministratorSidMemo.value;
	const script = "$ErrorActionPreference='Stop';$descriptor=New-Object System.Security.AccessControl.RawSecurityDescriptor 'D:(A;;FA;;;LA)';$descriptor.DiscretionaryAcl[0].SecurityIdentifier.Value";
	const systemRoot = dirname(dirname(windowsSystemExecutable("whoami.exe")));
	const output = execFileSync(windowsSystemExecutable("WindowsPowerShell\\v1.0\\powershell.exe"), ["-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")], { encoding: "utf8", timeout: 30000, maxBuffer: 4096, stdio: ["ignore", "pipe", "pipe"], windowsHide: true, env: canonicalSystemRootEnv(systemRoot) });
	const matches = output.match(/S-\d+(?:-\d+)+/gi) ?? [];
	if (matches.length !== 1 || !isWindowsSid(matches[0]!)) throw new Error("Windows local Administrator SID is unavailable");
	return (windowsLocalAdministratorSidMemo.value = matches[0]!.toUpperCase());
}

function windowsDacl(path: string): string {
	const archive = `.jero-acl-${randomUUID()}.txt`;
	const archivePath = join(dirname(path), archive);
	try {
		execFileSync(windowsSystemExecutable("icacls.exe"), [path, "/save", archive, "/c"], { cwd: dirname(path), encoding: "utf8", timeout: 15000, maxBuffer: 16384, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
		const sddl = readFileSync(archivePath, "utf16le").match(/D:[^\r\n]+/)?.[0];
		if (sddl === undefined) throw new Error("Windows DACL is unavailable");
		return sddl;
	} finally {
		try { unlinkSync(archivePath); } catch {}
	}
}

export type WindowsDaclValidationReason = "protection" | "ace-count" | "ace-shape" | "ace-type" | "ace-flags" | "ace-rights" | "ace-reserved-fields" | "ace-trustee" | "ace-duplicate";
export type WindowsDaclTrusteeClassification = "OW" | "CO" | "BU" | "AU" | "WD" | "LA" | "sid" | "other" | "missing";

export class WindowsDaclValidationError extends Error {
	readonly reason: WindowsDaclValidationReason;
	readonly trustee?: WindowsDaclTrusteeClassification;
	constructor(reason: WindowsDaclValidationReason, trustee?: WindowsDaclTrusteeClassification) {
		super(`Windows DACL validation failed: ${reason}${trustee === undefined ? "" : ` (${trustee})`}`);
		this.name = "WindowsDaclValidationError";
		this.reason = reason;
		this.trustee = trustee;
	}
}

export type WindowsOwnerClassification = "user" | "system" | "administrators" | "sid" | "other" | "missing";

export class WindowsOwnerValidationError extends Error {
	readonly owner: WindowsOwnerClassification;
	constructor(owner: WindowsOwnerClassification = "missing") {
		super(`Windows owner validation failed (${owner})`);
		this.name = "WindowsOwnerValidationError";
		this.owner = owner;
	}
}

function classifyWindowsTrustee(value: string | undefined): WindowsDaclTrusteeClassification {
	const trustee = value?.toUpperCase() ?? "";
	if (["OW", "CO", "BU", "AU", "WD", "LA"].includes(trustee)) return trustee as WindowsDaclTrusteeClassification;
	if (isWindowsSid(trustee)) return "sid";
	return trustee === "" ? "missing" : "other";
}

function isWindowsSid(value: string): boolean {
	return /^S-\d+(?:-\d+)+$/i.test(value);
}

export function validatePrivateWindowsDacl(dacl: string, user: string, protectedDacl: boolean, localAdministratorSid?: string): void {
	if (protectedDacl && !dacl.startsWith("D:P")) throw new WindowsDaclValidationError("protection");
	const trustees = new Map([[user.toUpperCase(), "user"], [WINDOWS_SYSTEM, "system"], ["SY", "system"], [WINDOWS_ADMINISTRATORS, "administrators"], ["BA", "administrators"]]);
	if (isWindowsSid(user) && localAdministratorSid !== undefined && isWindowsSid(localAdministratorSid) && user.toUpperCase() === localAdministratorSid.toUpperCase()) trustees.set("LA", "user");
	const aces = [...dacl.matchAll(/\(([^()]*)\)/g)].map((match) => match[1]!.split(";"));
	const expectedFlags = protectedDacl ? "OICI" : "ID";
	const granted = new Set<string>();
	for (const ace of aces) {
		const trustee = trustees.get(ace[5]?.toUpperCase() ?? "");
		if (ace.length !== 6) throw new WindowsDaclValidationError("ace-shape");
		if (ace[0] !== "A") throw new WindowsDaclValidationError("ace-type");
		if (ace[1] !== expectedFlags) throw new WindowsDaclValidationError("ace-flags");
		if (ace[2] !== "FA") throw new WindowsDaclValidationError("ace-rights");
		if (ace[3] !== "" || ace[4] !== "") throw new WindowsDaclValidationError("ace-reserved-fields");
		if (trustee === undefined) throw new WindowsDaclValidationError("ace-trustee", classifyWindowsTrustee(ace[5]));
		if (granted.has(trustee)) throw new WindowsDaclValidationError("ace-duplicate");
		granted.add(trustee);
	}
	if (granted.size !== 3) throw new WindowsDaclValidationError("ace-count");
}

export function validatePrivateWindowsOwner(owner: string | undefined, user: string): void {
	const normalizedOwner = owner?.toUpperCase();
	// 所有者隐式控制 DACL，因此只接受该精确 DACL 已授予完全控制的主体。
	if (normalizedOwner === undefined) throw new WindowsOwnerValidationError("missing");
	if (!isWindowsSid(user) || !isWindowsSid(normalizedOwner)) throw new WindowsOwnerValidationError(isWindowsSid(normalizedOwner) ? "sid" : "other");
	if (normalizedOwner === user.toUpperCase()) return;
	if (normalizedOwner === WINDOWS_SYSTEM) return;
	if (normalizedOwner === WINDOWS_ADMINISTRATORS) return;
	throw new WindowsOwnerValidationError("sid");
}

interface WindowsAclIdentity {
	user: string;
	localAdministrator: string;
}

type WindowsObjectKind = "file" | "directory";

function windowsAclIdentity(): WindowsAclIdentity {
	return { user: windowsUserSid(), localAdministrator: windowsLocalAdministratorSid() };
}

const windowsOwnerSidMemo = new Map<string, string>();
const windowsOwnerBatchEnv = "JERO_PI_CANDIDATE_OWNER_PATHS";
function windowsOwnerSidsBatch(paths: readonly string[]): string[] {
	const script = "$ErrorActionPreference='Continue';$paths=$env:JERO_PI_CANDIDATE_OWNER_PATHS.Split(';');foreach($p in $paths){try{$item=Get-Item -LiteralPath $p -Force;$sec=$item.GetAccessControl([System.Security.AccessControl.AccessControlSections]::Owner);$sid=$sec.GetOwner([System.Security.Principal.SecurityIdentifier]);Write-Output $sid.Value}catch{Write-Output 'ERROR'}}" ;
	const systemRoot = dirname(dirname(windowsSystemExecutable("whoami.exe")));
	const output = execFileSync(windowsSystemExecutable("WindowsPowerShell\\v1.0\\powershell.exe"), ["-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")], { encoding: "utf8", timeout: 60000, maxBuffer: 64 * 1024, stdio: ["ignore", "pipe", "pipe"], windowsHide: true, env: canonicalSystemRootEnv(systemRoot, { [windowsOwnerBatchEnv]: paths.join(";") }) });
	const lines = output.split(/\r?\n/).filter((line) => line.trim() !== "");
	return paths.map((_, index) => (lines[index] ?? "ERROR").trim());
}

function windowsOwnerSid(path: string, kind: WindowsObjectKind): string {
	const cacheKey = kind + ":" + path;
	const cached = windowsOwnerSidMemo.get(cacheKey);
	if (cached !== undefined) return cached;
	if (path.length === 0 || path.length > 32767 || path.includes("\0")) throw new WindowsOwnerValidationError();
	const script = kind === "file"
		? "$ErrorActionPreference='Stop';$acl=[System.IO.File]::GetAccessControl($env:JERO_PI_CANDIDATE_OWNER_PATH,[System.Security.AccessControl.AccessControlSections]::Owner);$acl.GetOwner([System.Security.Principal.SecurityIdentifier]).Value"
		: "$ErrorActionPreference='Stop';$acl=[System.IO.Directory]::GetAccessControl($env:JERO_PI_CANDIDATE_OWNER_PATH,[System.Security.AccessControl.AccessControlSections]::Owner);$acl.GetOwner([System.Security.Principal.SecurityIdentifier]).Value";
	const systemRoot = dirname(dirname(windowsSystemExecutable("whoami.exe")));
	let output: string;
	try {
		output = execFileSync(windowsSystemExecutable("WindowsPowerShell\\v1.0\\powershell.exe"), ["-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")], { encoding: "utf8", maxBuffer: 4096, stdio: ["ignore", "pipe", "pipe"], windowsHide: true, env: canonicalSystemRootEnv(systemRoot, { JERO_PI_CANDIDATE_OWNER_PATH: path }), timeout: 30000 });
	} catch {
		throw new WindowsOwnerValidationError();
	}
	const matches = output.match(/S-\d+(?:-\d+)+/gi) ?? [];
	if (matches.length !== 1 || !isWindowsSid(matches[0]!)) throw new WindowsOwnerValidationError();
	const sid = matches[0]!.toUpperCase();
	windowsOwnerSidMemo.set(cacheKey, sid);
	return sid;
}

export function assertTrustedWindowsOwner(path: string, kind: WindowsObjectKind): void {
	validatePrivateWindowsOwner(windowsOwnerSid(path, kind), windowsUserSid());
}

function assertPrivateWindowsDacl(path: string, kind: WindowsObjectKind, protectedDacl: boolean, identity: WindowsAclIdentity = windowsAclIdentity()): void {
	validatePrivateWindowsOwner(windowsOwnerSid(path, kind), identity.user);
	validatePrivateWindowsDacl(windowsDacl(path), identity.user, protectedDacl, identity.localAdministrator);
}

function enforcePrivateWindowsDacl(path: string, identity: WindowsAclIdentity = windowsAclIdentity()): void {
	validatePrivateWindowsOwner(windowsOwnerSid(path, "directory"), identity.user);
	const { user, localAdministrator } = identity;
	const sddl = `D:P(A;OICI;FA;;;${user})(A;OICI;FA;;;${WINDOWS_SYSTEM})(A;OICI;FA;;;${WINDOWS_ADMINISTRATORS})`;
	// 强制执行必须构造精确的三 ACE 受保护 DACL（任何无关的显式授权
	// 都不得幸存）；icacls /grant:r 无法移除其他受托人的显式 ACE，
	// 因此这次一次性写入保持在精确的 SetAccessControl 路径上。
	// 它只在每次父目录准备时运行一次——高频断言路径改用快速的原生
	// icacls 读取 DACL。
	const script = "$ErrorActionPreference='Stop';$acl=New-Object System.Security.AccessControl.DirectorySecurity;$acl.SetSecurityDescriptorSddlForm($env:JERO_PI_CANDIDATE_ACL_SDDL,[System.Security.AccessControl.AccessControlSections]::Access);[System.IO.Directory]::SetAccessControl($env:JERO_PI_CANDIDATE_ACL_PATH,$acl)";
	const systemRoot = dirname(dirname(windowsSystemExecutable("whoami.exe")));
	execFileSync(windowsSystemExecutable("WindowsPowerShell\\v1.0\\powershell.exe"), ["-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")], { encoding: "utf8", maxBuffer: 16384, stdio: ["ignore", "pipe", "pipe"], windowsHide: true, env: canonicalSystemRootEnv(systemRoot, { JERO_PI_CANDIDATE_ACL_PATH: path, JERO_PI_CANDIDATE_ACL_SDDL: sddl }), timeout: 30000 });

	assertPrivateWindowsDacl(path, "directory", true, identity);
}

function privateWindowsDacl(path: string, kind: WindowsObjectKind, protectedDacl: boolean, enforce = false): void {
	if (testingWindowsAclAuthority !== undefined) return testingWindowsAclAuthority(path);
	if (enforce) enforcePrivateWindowsDacl(path);
	else assertPrivateWindowsDacl(path, kind, protectedDacl);
}

function privateWindowsCandidateOwnerBoundary(commonDir: string, enforce = false): void {
	const boundary = [commonDir, join(commonDir, "jero-review"), join(commonDir, "jero-review", "candidate-views")];
	if (testingWindowsAclAuthority !== undefined) {
		for (const path of boundary) testingWindowsAclAuthority(path);
		return;
	}
	const identity = windowsAclIdentity();
	// 一次批量 PowerShell 调用解析所有边界所有者 SID（按路径记忆化）；
	// 此前被它取代的逐路径冷启动往返是 Windows 上每次候选视图创建的
	// 主要开销。
	if (!boundary.every((path) => windowsOwnerSidMemo.has("directory:" + path))) {
		const owners = windowsOwnerSidsBatch(boundary);
		boundary.forEach((path, index) => {
			const sid = (owners[index] ?? "").trim().toUpperCase();
			if (sid === "ERROR" || !isWindowsSid(sid)) {
				// 回退到单路径读取器，让类型化校验错误精确落在
				// 失败的那个路径上（并填充记忆缓存）。
				windowsOwnerSid(path, "directory");
				return;
			}
			windowsOwnerSidMemo.set("directory:" + path, sid);
		});
	}
	if (enforce) {
		for (const path of boundary) validatePrivateWindowsOwner(windowsOwnerSid(path, "directory"), identity.user);
		for (const path of boundary) enforcePrivateWindowsDacl(path, identity);
		return;
	}
	for (const path of boundary) assertPrivateWindowsDacl(path, "directory", true, identity);
}

// 主机名或仓库局部 nonce 无法证明 PID 是本地的。
// 绑定内核启动标识，在 Linux 上还绑定其 PID 命名空间。不支持或
// 不可用的来源会禁用回收（包括跨重启回收）。
function localHost(): string | null {
	try {
		if (process.platform === "win32") {
			// MachineGuid 是 Windows 的稳定机器身份（跨重启不变），与
			// darwin 的 bootsessionuuid、linux 的 boot_id+pid ns 同构。
			// 没有它，host 恒为 null，dead() 永远为假——Windows 上死候选
			// 永不被回收。
			const reg = join(process.env.SystemRoot ?? "C:\\Windows", "System32", "reg.exe");
			const output = execFileSync(reg, ["query", "HKLM\\SOFTWARE\\Microsoft\\Cryptography", "/v", "MachineGuid"], { encoding: "utf8", timeout: 5000, maxBuffer: 4096, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
			const guid = output.match(/MachineGuid\s+REG_SZ\s+([0-9A-Fa-f-]+)/)?.[1];
			if (guid) return `windows:${guid.toLowerCase()}`;
		}
		if (process.platform === "darwin") {
			const boot = execFileSync("/usr/sbin/sysctl", ["-n", "kern.bootsessionuuid"], { encoding: "utf8", timeout: 1000, maxBuffer: 4096, stdio: ["ignore", "pipe", "pipe"] }).trim();
			if (BOOT_UUID.test(boot)) return `darwin:${boot.toLowerCase()}`;
		}
		if (process.platform === "linux") {
			const boot = readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim();
			const namespace = readlinkSync("/proc/self/ns/pid");
			if (BOOT_UUID.test(boot) && /^pid:\[\d+\]$/.test(namespace)) return `linux:${boot}:${namespace}`;
		}
	} catch { /* 没有仅凭远端/PID 的回退。 */ }
	return null;
}

export function samePath(path: string, expected: string, platform: NodeJS.Platform): boolean {
	if (platform !== "win32") return path === expected;
	const canonical = (value: string): string => {
		try {
			return realpathSync.native(value).replaceAll("\\", "/").toLowerCase();
		} catch {
			return join(realpathSync.native(dirname(value)), basename(value)).replaceAll("\\", "/").toLowerCase();
		}
	};
	return canonical(path) === canonical(expected);
}

function directory(path: string, privateMode = false, platform: NodeJS.Platform = process.platform): string {
	const stat = lstatSync(path);
	const uid = process.getuid?.();
	if (!stat.isDirectory() || stat.isSymbolicLink() || !samePath(realpathSync(path), path, platform) ||
		(privateMode && platform !== "win32" && (uid === undefined || stat.uid !== uid || (stat.mode & 0o077) !== 0))) throw new Error("Unsafe candidate owner directory");
	if (privateMode && platform === "win32") privateWindowsDacl(path, "directory", true);
	return `${stat.dev}:${stat.ino}`;
}

export function assertCandidateOwnerParent(commonDir: string, platform: NodeJS.Platform = process.platform): string {
	directory(commonDir, false, platform);
	const control = join(commonDir, "jero-review");
	directory(control, false, platform);
	const parent = join(commonDir, "jero-review", "candidate-views");
	directory(parent, false, platform);
	if (platform === "win32") privateWindowsCandidateOwnerBoundary(commonDir);
	else directory(parent, true, platform);
	return parent;
}

export function prepareCandidateOwnerParent(commonDir: string, platform: NodeJS.Platform = process.platform): string {
	directory(commonDir, false, platform);
	const control = join(commonDir, "jero-review");
	directory(control, false, platform);
	const parent = join(commonDir, "jero-review", "candidate-views");
	directory(parent, false, platform);
	if (platform === "win32") {
		privateWindowsCandidateOwnerBoundary(commonDir, true);
		return parent;
	}
	return assertCandidateOwnerParent(commonDir, platform);
}

function regular(path: string, privateMode = false, platform: NodeJS.Platform = process.platform): string {
	const stat = lstatSync(path);
	const uid = process.getuid?.();
	if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || !samePath(realpathSync(path), path, platform) || stat.size > 16384 ||
		(privateMode && platform !== "win32" && (uid === undefined || stat.uid !== uid || (stat.mode & 0o777) !== 0o600))) throw new Error("Unsafe candidate owner file");
	if (privateMode && platform === "win32") privateWindowsDacl(path, "file", false);
	return `${stat.dev}:${stat.ino}`;
}

function syncDirectory(path: string): void {
	// Windows 不允许对目录句柄 fsync；在此之前标记文件本身仍会被 fsync，
	// 此处是平台相关的空操作。
	if (process.platform === "win32") return;
	const fd = openSync(path, "r");
	try { fsyncSync(fd); } finally { closeSync(fd); }
}

function removeExactPrivateFile(path: string, identity: string, platform: NodeJS.Platform): void {
	try {
		if (regular(path, true, platform) !== identity) return;
		unlinkSync(path);
		syncDirectory(dirname(path));
	} catch { /* 未经证明或已被替换的文件得以幸存。 */ }
}

function seedCreatorOwnerSid(path: string, kind: WindowsObjectKind): void {
	if (process.platform !== "win32") return;
	windowsOwnerSidMemo.set(kind + ":" + path, windowsUserSid());
}

function exclusiveFile(path: string, content: string, platform: NodeJS.Platform = process.platform, rollbackOnFailure = false): string {
	let identity: string | undefined;
	try {
		const fd = openSync(path, "wx", 0o600);
		if (platform === "win32") seedCreatorOwnerSid(path, "file");
		try {
			identity = regular(path, true, platform);
			writeFileSync(fd, content);
			fsyncSync(fd);
		} finally { closeSync(fd); }
		syncDirectory(dirname(path));
		return identity;
	} catch (error) {
		if (rollbackOnFailure && identity !== undefined) removeExactPrivateFile(path, identity, platform);
		throw error;
	}
}

function markerPath(root: string): string { return `${root}.owner.json`; }

export function createCandidateOwner(commonDir: string, root: string, platform: NodeJS.Platform = process.platform): CandidateViewOwner {
	const parent = assertCandidateOwnerParent(commonDir, platform);
	const uuid = basename(root);
	if (!UUID.test(uuid) || root !== join(parent, uuid) || lstatSync(root, { throwIfNoEntry: false })) throw new Error("Unsafe candidate owner root");
	const owner: CandidateViewOwner = { version: 1, uuid, token: randomUUID(), pid: process.pid, host: localHost(), root, commonDir };
	// 任何写入/fsync 失败都会在 Git 注册该视图之前中止创建。
	const marker = markerPath(root);
	let markerIdentity: string | undefined;
	try {
		markerIdentity = exclusiveFile(marker, JSON.stringify(owner), platform, true);
		syncDirectory(dirname(parent));
		syncDirectory(commonDir);
	} catch (error) {
		if (markerIdentity !== undefined) removeExactPrivateFile(marker, markerIdentity, platform);
		throw error;
	}
	return Object.freeze(owner);
}

function readOwner(commonDir: string, root: string, platform: NodeJS.Platform = process.platform): CandidateViewOwner {
	const parent = assertCandidateOwnerParent(commonDir, platform);
	if (!UUID.test(basename(root)) || root !== join(parent, basename(root))) throw new Error("Candidate owner escaped parent");
	regular(markerPath(root), true, platform);
	const owner = JSON.parse(readFileSync(markerPath(root), "utf8")) as CandidateViewOwner;
	if (!owner || Object.keys(owner).sort().join(",") !== "commonDir,host,pid,root,token,uuid,version" || owner.version !== 1 ||
		owner.uuid !== basename(root) || !UUID.test(owner.token) || !Number.isSafeInteger(owner.pid) || owner.pid <= 0 ||
		owner.root !== root || owner.commonDir !== commonDir || !(owner.host === null || typeof owner.host === "string")) throw new Error("Malformed candidate owner");
	return owner;
}

function dead(owner: CandidateViewOwner): boolean {
	return owner.host !== null && owner.host === localHost() && conservativeOwnerDeathProofV1({
		pid: owner.pid, token: owner.token, owner_hash: "", repository_id: owner.commonDir, authority_id: owner.uuid,
	});
}

function registration(root: string, commonDir: string, git: Git, platform: NodeJS.Platform = process.platform): string {
	const rows = git(["worktree", "list", "--porcelain", "-z"]).split("\0\0");
	const matching = rows.filter((row) => {
		const worktree = row.split("\0")[0];
		return worktree !== undefined && worktree.startsWith("worktree ") && samePath(worktree.slice(9), root, platform);
	});
	if (matching.length !== 1 || matching[0]!.split("\0").some((field) => /^(locked|prunable)( |$)/.test(field))) throw new Error("Candidate registration is ambiguous");
	const gitFile = join(root, ".git");
	regular(gitFile);
	const pointer = readFileSync(gitFile, "utf8");
	if (!pointer.startsWith("gitdir: ") || !pointer.endsWith("\n")) throw new Error("Unsafe candidate Git pointer");
	const admin = pointer.slice(8, -1);
	if (!samePath(dirname(admin), join(commonDir, "worktrees"), platform)) throw new Error("Candidate admin escaped common directory");
	directory(join(commonDir, "worktrees"));
	directory(admin);
	regular(join(admin, "gitdir"));
	regular(join(admin, "commondir"));
	const gitdir = readFileSync(join(admin, "gitdir"), "utf8");
	if (!gitdir.endsWith("\n") || !samePath(gitdir.slice(0, -1), gitFile, platform) ||
		!samePath(resolve(admin, readFileSync(join(admin, "commondir"), "utf8").trim()), commonDir, platform)) throw new Error("Candidate Git backlinks changed");
	return matching[0]! + pointer;
}

export function removeCandidateOwner(owner: CandidateViewOwner, git: Git, makeWritable: (root: string) => void, orphan = false, platform: NodeJS.Platform = process.platform): void {
	const { root, commonDir } = owner;
	const parent = assertCandidateOwnerParent(commonDir, platform);
	const expected = JSON.stringify(owner);
	const parentIdentity = directory(parent, true, platform);
	const markerIdentity = regular(markerPath(root), true, platform);
	const checkOwner = (): void => {
		if (directory(parent, true, platform) !== parentIdentity || regular(markerPath(root), true, platform) !== markerIdentity ||
			JSON.stringify(readOwner(commonDir, root, platform)) !== expected || (orphan ? !dead(owner) : owner.pid !== process.pid)) throw new Error("Candidate ownership changed");
	};
	checkOwner();
	const lock = `${root}.reaper-lock`;
	const token = randomUUID();
	exclusiveFile(lock, token); // EEXIST 即终局；未知/过期锁绝不窃取。
	const lockIdentity = regular(lock, true, platform);
	const checkLock = (): void => {
		if (regular(lock, true, platform) !== lockIdentity || readFileSync(lock, "utf8") !== token) throw new Error("Candidate reaper lock changed");
	};
	try {
		checkOwner();
		const identity = [directory(parent, true, platform), directory(root), regular(markerPath(root), true, platform)];
		const registered = registration(root, commonDir, git, platform);
		checkOwner();
		checkLock();
		makeWritable(root);
		// Git 与 chmod 是竞态边界：在请求 Git 移除该根目录之前，
		// 立即重复路径、所有者、锁与精确注册证明。
		const secondRegistration = registration(root, commonDir, git, platform);
		if (secondRegistration !== registered ||
			JSON.stringify([directory(parent, true, platform), directory(root), regular(markerPath(root), true, platform)]) !== JSON.stringify(identity)) throw new Error("Candidate cleanup identity changed");
		checkOwner();
		checkLock();
		git(["worktree", "remove", "--force", root]);
		// Git 失败或不完整的移除绝不触发递归 rm。
		if (lstatSync(root, { throwIfNoEntry: false }) || git(["worktree", "list", "--porcelain", "-z"]).split("\0\0").some((row) => {
			const worktree = row.split("\0")[0];
			return worktree !== undefined && worktree.startsWith("worktree ") && samePath(worktree.slice(9), root, platform);
		})) throw new Error("Candidate removal is incomplete");
		checkOwner();
		checkLock();
		unlinkSync(markerPath(root));
		syncDirectory(parent);
	} finally {
		// 即使删除本身失败，也只释放这一个精确匹配的锁。
		try { assertCandidateOwnerParent(commonDir, platform); checkLock(); unlinkSync(lock); syncDirectory(parent); } catch {}
	}
}

export function sweepCandidateOwners(commonDir: string, git: Git, makeWritable: (root: string) => void, platform: NodeJS.Platform = process.platform): void {
	try {
		const parent = assertCandidateOwnerParent(commonDir, platform);
		for (const name of readdirSync(parent)) {
			if (!name.endsWith(".owner.json")) continue;
			try {
				const owner = readOwner(commonDir, join(parent, name.slice(0, -11)), platform);
				if (dead(owner)) removeCandidateOwner(owner, git, makeWritable, true, platform);
			} catch { /* 未知、遗留、不安全、未注册及有争用的条目得以幸存。 */ }
		}
	} catch { /* 启动/物化清扫尽力而为；绝不创建存储。 */ }
}
