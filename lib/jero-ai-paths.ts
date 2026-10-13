// 包路径常量：包根与资产目录。零依赖模块——被其他模块在顶层
// const 初始化里引用（jero-ai-prompts 的镜像根、sdd-preflight 的资产根），
// 因此这里不得 import 任何其他 jero-ai-* 模块，否则顶层求值顺序会把
// 引用方拖进 TDZ。

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const PACKAGE_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

export const ASSETS_DIR = join(PACKAGE_ROOT, "assets");
