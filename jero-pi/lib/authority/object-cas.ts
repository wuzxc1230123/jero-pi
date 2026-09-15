import { closeSync, existsSync, fsyncSync, linkSync, mkdirSync, openSync, readFileSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { canonicalBytesV1, canonicalJsonV1, parseCanonicalJsonV1, sha256Hex } from "../review-canonical.ts";

// Generic content-addressed object store for the jero authority
// (design §5.1.2: `objects/<sha256>` under the jero-review store root).
//
// The immutable-install discipline (mkdir 0o700 parent; byte-equal existing
// object is an idempotent no-op, different bytes are a conflict; otherwise
// wx-temp 0o600 -> fsync -> link -> directory fsync, win32 skips the
// directory fsync) is mirrored exactly from review-object-store.ts
// `installImmutable`. Hashes are plain SHA-256 over the canonical bytes —
// content addressing, not domain-separated identity.

export class JeroObjectCasError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "JeroObjectCasError";
	}
}

export interface JeroCasPutOptionsV1 {
	/** Expected value of the record's `schema` field (fail-closed on mismatch). */
	schema: string;
}

export interface JeroCasPutResultV1 {
	/** Content hash of the installed canonical bytes (also the object id). */
	hash: string;
	/** True when the object was already present with identical bytes. */
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
	 * Installs a typed record as canonical JSON at `objects/<sha256>`.
	 * Installing identical bytes twice is an idempotent no-op; different
	 * bytes under the same hash fail closed as a conflict carrying both
	 * the requested and the actually-stored content hashes.
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
	 * Reads and strictly decodes the object at `objects/<hash>`. The stored
	 * bytes must re-serialize to their own canonical form and must hash to
	 * the requested id before the caller-supplied decoder runs.
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
