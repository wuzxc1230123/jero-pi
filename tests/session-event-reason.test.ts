// session-event-reason 微测：reason 是区分"会话替换"与"真退出"的唯一
// 信号（/new、/resume、/fork、/reload 复用扩展实例），判别行为此前仅经
// 扩展入口测试间接触达，此处直测钉住。

import assert from "node:assert/strict";
import test from "node:test";

import { sessionEventReason } from "../lib/session-event-reason.ts";

test("sessionEventReason 识别五种合法 reason 并拒绝其余一切形态", () => {
	for (const reason of ["reload", "new", "resume", "fork", "quit"] as const) {
		assert.equal(sessionEventReason({ reason }), reason);
	}
	assert.equal(sessionEventReason({ reason: undefined }), undefined);
	assert.equal(sessionEventReason({ reason: "RELOAD" }), undefined, "大小写敏感：非精确词表拒绝");
	assert.equal(sessionEventReason({ reason: "restart" }), undefined);
	assert.equal(sessionEventReason({}), undefined);
	assert.equal(sessionEventReason(undefined), undefined);
	assert.equal(sessionEventReason(null), undefined);
	assert.equal(sessionEventReason("reload"), undefined, "非对象事件不解读");
});
