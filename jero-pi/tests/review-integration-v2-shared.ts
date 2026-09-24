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

// 助手统一住 shared：分片互相 import 会令被导入分片的顶层 test() 注册在
// 导入方进程里重跑一遍，整个家族的用例被成倍执行。
export function repairAssessment(status: "eligible" | "unsupported" = "unsupported"): JsonObject {
	if (status === "unsupported") {
		return {
			schema: "gentle-ai.review-authority-repair-assessment/v1",
			status: "unsupported",
			counts: { lineages: 0, compact_lineages: 0, legacy_lineages: 0, events: 0, bytes: 0, eligible_candidates: 0, unsupported_lineages: 0, conflicts: 0 },
			supported_operations: ["review/complete-fix", "review/validate-fix"],
			authorization_schema: "gentle-ai.review-repair-authorization/v1",
		};
	}
	return {
		schema: "gentle-ai.review-authority-repair-assessment/v1",
		status: "eligible",
		class: "legacy_v1_historical_alias",
		cause: "unsupported_historical_v1_operation_alias",
		disposition: "quarantine-approved-historical-alias",
		repository_binding: digest,
		candidate: {
			lineage_id: "review-legacy-fixture",
			revision: digest,
			chain_identity: digest,
			event_count: 3,
			alias_event_count: 1,
			operations: ["review/complete-fix"],
		},
		counts: { lineages: 1, compact_lineages: 0, legacy_lineages: 1, events: 3, bytes: 128, eligible_candidates: 1, unsupported_lineages: 0, conflicts: 0 },
		supported_operations: ["review/complete-fix", "review/validate-fix"],
		authorization_schema: "gentle-ai.review-repair-authorization/v1",
	};
}

export function unachievableSlot(overrides: Partial<JsonObject> = {}): JsonObject {
	return {
		lens: "review-risk",
		selected_order: 0,
		subject_hash: digest,
		reason: "relay_transport_bound_exceeded",
		withdraw: {
			operation: "review.capture-unachievable",
			command: `gentle-ai review capture-unachievable --lineage=review-fixture --expected-revision=${digest} --target=${digest} --repository-context=rctx1_${"e".repeat(64)} --request-hash=${digest} --withdraw=true`,
			arguments: [
				{ name: "lineage", value: "review-fixture", token: "--lineage=review-fixture" },
				{ name: "expected-revision", value: digest, token: `--expected-revision=${digest}` },
				{ name: "target", value: digest, token: `--target=${digest}` },
				{ name: "repository-context", value: `rctx1_${"e".repeat(64)}`, token: `--repository-context=rctx1_${"e".repeat(64)}` },
				{ name: "request-hash", value: digest, token: `--request-hash=${digest}` },
				{ name: "withdraw", value: "true", token: "--withdraw=true" },
			],
			binding: { lineage_id: "review-fixture", revision: digest, target_identity: digest, repository_context: `rctx1_${"e".repeat(64)}` },
		},
		...overrides,
	};
}
