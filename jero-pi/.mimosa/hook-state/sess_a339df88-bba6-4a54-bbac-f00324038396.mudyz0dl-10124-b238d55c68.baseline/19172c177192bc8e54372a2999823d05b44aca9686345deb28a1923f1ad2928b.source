// 敏感路径护栏：read/write/edit 工具的路径输入收集与拒绝。与命令护栏同级、互不依赖。
// 自 extensions/jero-ai.ts 拆分（机械平移，语义零改动）。


export const PATH_GUARDED_TOOL_NAMES = new Set(["read", "write", "edit"]);

export const PATH_INPUT_KEYS = new Set([
	"path",
	"paths",
	"file",
	"files",
	"filePath",
	"filePaths",
]);

export const SENSITIVE_PATH_PATTERNS: RegExp[] = [
	/(^|\/)\.ssh(?:\/|$)/,
	/(^|\/)\.credentials(?:\/|$)/,
	/(^|\/)library\/keychains(?:\/|$)/,
	/(^|\/)\.aws\/credentials$/,
	/(^|\/)\.config\/gh\/hosts\.ya?ml$/,
	/(^|\/)secrets(?:\/|$)/,
	/(^|\/)\.env(?:$|[./_-])/,
	/\.(?:pem|key|p12|pfx)$/,
];

