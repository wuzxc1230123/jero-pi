import { closeSync, existsSync, fsyncSync, linkSync, mkdirSync, openSync, readFileSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { canonicalBytesV1, canonicalJsonV1, parseCanonicalJsonV1, sha256Hex } from "../review-canonical.ts";

// jero 权威的通用内容寻址对象存储（设计 §5.1.2：jero-review 存储根
// 下的 `objects/<sha256>`）。
//
// 不可变安装纪律（父目录 mkdir 0o700；已存在对象字节相等则是幂等空
// 操作，字节不同则是冲突；否则 wx 临时文件 0o600 -> fsync -> link ->
// 目录 fsync，win32 跳过目录 fsync）精确镜像自
// review-object-store.ts 的 `installImmutable`。哈希是对权威字节的普通
// SHA-256——内容寻址，而非域分隔身份。

export class JeroObjectCasError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "JeroObjectCasError";
	}
}

export interface JeroCasPutOptionsV1 {
	/** 记录 `schema` 字段的期望值（不匹配则保守失败）。 */
	schema: string;
}

export interface JeroCasPutResultV1 {
	/** 已安装权威字节的内容哈希（同时是对象 id）。 */
	hash: string;
	/** 对象已以相同字节存在时为 true。 */
	idempotent: boolean;
}

export class JeroObjectCasV1 {
	readonly root: string;

	constructor(objectsRoot: string) {
		this.root = objectsRoot;
	}

	static forStore(storeRoot: string): JeroObjectCasV1 {
		return new JeroObjectCasV1(join(storeRoot, "objects"));
	}

	private objectPath(hash: string): string {
		if (!/^[0-9a-f]{64}$/.test(hash)) throw new JeroObjectCasError("Object hash is invalid");
		return join(this.root, hash);
	}

	/**
	 * 把类型化记录以权威 JSON 安装到 `objects/<sha256>`。两次安装相同
	 * 字节是幂等空操作；同一哈希下的不同字节以冲突保守失败，并携带
	 * 请求的与实际存储的两个内容哈希。
	 */
	put(record: unknown, options: JeroCasPutOptionsV1): JeroCasPutResultV1 {
		if (typeof record !== "object" || record === null || Array.isArray(record)) throw new JeroObjectCasError("CAS record must be an object");
		const schema = (record as Record<string, unknown>).schema;
		if (schema !== options.schema) throw new JeroObjectCasError(`CAS record schema mismatch: expected "${options.schema}", got ${schema === undefined ? "missing schema field" : JSON.stringify(schema)}`);
		const bytes = canonicalBytesV1(record);
		const hash = sha256Hex(bytes);
		const path = this.objectPath(hash);
		mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
		if (existsSync(path)) {
			const existing = readFileSync(path);
			if (!existing.equals(Buffer.from(bytes))) {
				throw new JeroObjectCasError(`Immutable object conflicts with existing bytes: stored content hashes to ${sha256Hex(existing)}, requested ${hash}`);
			}
			return { hash, idempotent: true };
		}
		const temporary = `${path}.${process.pid}.${Math.random().toString(16).slice(2)}.tmp`;
		try {
			writeFileSync(temporary, bytes, { mode: 0o600, flag: "wx" });
			this.fsyncFile(temporary);
			linkSync(temporary, path);
			this.fsyncDirectory(dirname(path));
		} catch (error) {
			if (existsSync(path) && Buffer.from(readFileSync(path)).equals(Buffer.from(bytes))) return { hash, idempotent: true };
			throw new JeroObjectCasError(`Immutable object installation failed: ${error instanceof Error ? error.message : String(error)}`);
		} finally {
			try {
				unlinkSync(temporary);
			} catch {}
		}
		return { hash, idempotent: false };
	}

	/**
	 * 读取并严格解码 `objects/<hash>` 处的对象。在调用方提供的解码器
	 * 运行之前，存储的字节必须能重新序列化为自身的权威形态，且必须
	 * 哈希到所请求的 id。
	 */
	get<T>(hash: string, decode: (value: unknown) => T): T {
		const path = this.objectPath(hash);
		let bytes: Buffer;
		try {
			bytes = readFileSync(path);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new JeroObjectCasError(`Object is missing: ${hash}`);
			throw new JeroObjectCasError(`Object is unreadable: ${hash}`);
		}
		if (sha256Hex(bytes) !== hash) throw new JeroObjectCasError(`Object content does not hash to its id: ${hash}`);
		let parsed: unknown;
		try {
			parsed = parseCanonicalJsonV1(bytes);
		} catch (error) {
			throw new JeroObjectCasError(`Object is not canonical JSON: ${error instanceof Error ? error.message : String(error)}`);
		}
		return decode(parsed);
	}

	has(hash: string): boolean {
		try {
			return existsSync(this.objectPath(hash));
		} catch {
			return false;
		}
	}

	private fsyncFile(path: string): void {
		const descriptor = openSync(path, "r+");
		try {
			fsyncSync(descriptor);
		} finally {
			closeSync(descriptor);
		}
	}

	private fsyncDirectory(path: string): void {
		if (!statSync(path).isDirectory()) throw new JeroObjectCasError("Expected a directory");
		if (process.platform === "win32") return;
		const descriptor = openSync(path, "r");
		try {
			fsyncSync(descriptor);
		} finally {
			closeSync(descriptor);
		}
	}
}
