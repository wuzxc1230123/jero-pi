// review-integration-v2 测试共享夹具与助手：自 review-integration-v2.test.ts 机械平移（语义零改动）。

import { default as assert } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { default as test } from "node:test";
import {
	decodeAuthorityRepairAssessmentV1, decodeReviewArtifactSubjectV2, decodeReviewCapabilitiesV2,
	decodeReviewConsentV2, decodeReviewFailureV2, decodeReviewNextTransitionV3,
	decodeReviewProjectionV1, decodeReviewRepairV2, decodeReviewStartV3, decodeReviewStatusV3,
	REVIEW_INTEGRATION_CONTRACT, REVIEW_START_STATE
} from "../lib/authority/wire-contract.ts";


export const fixtureRoot = join(process.cwd(), "tests", "fixtures", "review-integration", "v2", "fixtures");
export const devFixtureRoot = join(process.cwd(), "tests", "fixtures", "devbinary");
export const fixture = <T = unknown>(name: string): T => JSON.parse(readFileSync(join(fixtureRoot, name), "utf8")) as T;
export const devFixture = <T = unknown>(name: string): T => JSON.parse(readFileSync(join(devFixtureRoot, name), "utf8")) as T;
export const executableDigest = "dcc846103b16d365eaeeb9d7f289c23fc4f2897f23def1cb3fe7f05557b64705";
export const digest = `sha256:${"a".repeat(64)}`;

export type JsonObject = Record<string, unknown>;
export type Decoder = (value: unknown) => unknown;

export function clone<T>(value: T): T {
	return structuredClone(value);
}

export function assertRequired(decoder: Decoder, source: JsonObject, fields: readonly string[]): void {
	for (const field of fields) {
		const candidate = clone(source);
		delete candidate[field];
		assert.throws(() => decoder(candidate), new RegExp(`${field}.*required|required.*${field}`), field);
	}
}

export function assertNestedRequired(decoder: Decoder, source: JsonObject, path: readonly string[], fields: readonly string[]): void {
	for (const field of fields) {
		const candidate = clone(source);
		let target = candidate;
		for (const segment of path) target = target[segment] as JsonObject;
		delete target[field];
		assert.throws(() => decoder(candidate), /required/, `${path.join(".")}.${field}`);
	}
}

export function assertAdditionalProperty(decoder: Decoder, source: JsonObject, path: readonly string[] = []): void {
	const candidate = clone(source);
	let target = candidate;
	for (const segment of path) target = target[segment] as JsonObject;
	target.unadvertised = true;
	assert.throws(() => decoder(candidate), /not allowed/, path.length === 0 ? "top-level" : path.join("."));
}

