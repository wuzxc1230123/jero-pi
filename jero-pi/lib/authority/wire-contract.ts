// D7：线上契约，内化到权威之下（设计 6，review-integration-v2 -> lib/authority）。
// 每个 gentle-ai.* schema 字符串在 P5 身份改造之前保持逐字不变；本模块拥有控制器消费、
// wire.ts 投影其上的线上词汇。
// 兼容门面：线上契约六模块统一再导出，消费方 import 路径不变。
export * from "./wire-contract-enums.ts";
export * from "./wire-contract-interfaces.ts";
export * from "./wire-contract-decode-helpers.ts";
export * from "./wire-contract-decode-start.ts";
export * from "./wire-contract-decode-status.ts";
export * from "./wire-contract-last-event.ts";
