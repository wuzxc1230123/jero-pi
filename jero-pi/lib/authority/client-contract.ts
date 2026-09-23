// D7：客户端契约，内化到权威之下（设计 6，native-review-cli -> lib/authority）。
// 保守失败的桩保留为可测试注入的参考实现与 Q-C 的不可达成表面；
// 生产默认值是进程内适配器（lib/jero-authority-cli.ts）。
// 兼容门面：客户端契约三模块统一再导出，消费方 import 路径不变。
export * from "./client-contract-types.ts";
export * from "./client-contract-surface.ts";
export * from "./client-contract-decode.ts";
