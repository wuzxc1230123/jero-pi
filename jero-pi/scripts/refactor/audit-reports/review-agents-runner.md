# 代理运行器+视图审核报告

## 文件级问题清单

### P1

1. **agents-runner.ts:815-821** — `receive()` 中 `this.armStall(id, live)` 只在入站 RPC 事件时复位看门狗；`send()`（行 685-694）向子进程写入 `get_state`/`prompt`/`abort` 等出站命令**不**复位。若子进程静默运行不回应答（如长 bash 调用无流式输出），这两个挂起的 Promise 等待期间停滞看门狗可能以 "stalled" 误杀健康任务。修法：`send()` 成功写入后也调用 `this.armStall(id, live)`，或将看门狗语义改为"距上次双向活动"。

2. **agents-runner.ts:386-398** — `JsonLines.push()` 的 `this.buffer` 无界累积：恶意/异常子进程持续输出不含 `\n` 的超长行时内存无限增长。修法：buffer 长度超阈值（如 1MB）时丢弃并报错或终止子进程。

3. **agents-runner.ts:473 + 524-529** — `run()` 把 `finalizeRemediation` 存入 `remediationFinalizers` Map，仅在 `finish()` 行 1037 删除；若任务在 `launch()` 内 `store.update` 等同步代码抛异常而未到达 `finish()`（行 587 的 catch 会走 finish，但 `store.add`/`store.update` 自身抛错则不会），Map 条目永久泄漏。修法：在 `run()` 的 queue.push 后用 try/catch 包裹，失败即 `remediationFinalizers.delete(task.id)`。

4. **agents-runner.ts:445 与 479** — `run()` 与 `createTask()` 对 `researchArtifact`/`sddRemediation` 各自 `structuredClone` 一次，同一对象被克隆两次（`createTask` 行 441/445，`run` 行 472/479），纯浪费。修法：只在 `createTask` 克隆，`run` 直接复用 `task` 上已克隆的字段。

5. **agents-view.ts:71** — `SESSION_FINISHED_TTL_MS = 15 * 60_000` 仅被 `tests/agents-grouping.test.ts` 导入使用；视图内 `inScope(task, _now)`（行 471-474）**完全忽略 `_now` 参数**，TTL 在生产代码中无任何消费者。修法：要么实现 TTL 过滤（`now - task.endedAt < TTL`），要么删除常量并同步改测试。

6. **agents-view.ts:383** — `render()` 中 `if (this.tasks.some((task) => !this.inScope(task, now))) this.refreshTasks();` 是**死分支**：`inScope` 对已结束任务返回 `false`（因 `!isFinished` 前置），而 `this.tasks` 已被 `refreshTasks` 过滤为 `!isFinished(task.status)`（行 536-537），故 `some(...)` 恒为 false，`refreshTasks()` 永不会被此行触发。修法：删除该行，或改为按 TTL 重新过滤。

7. **agents-view.ts:748** — `footer()` 计算所需宽度 `controls.reduce((sum, c) => sum + c.label.length + 1, -1)` 用 `label.length`（UTF-16 码元数）而非 `visibleWidth(label)`（显示列宽）。当前标签全是 ASCII（"[ Follow ]" 等）故恰好正确，一旦标签含宽字符（中文/全角符号）立即错位。修法：改用 `visibleWidth(control.label)`。

### P2

8. **agents-runner.ts:430-433** — `prepareRemediation()` 的独占性检查（`store.list().some(...)`）与后续 `createTask` 之间无原子性；两个并发 `prepareRemediation` 调用可双双通过检查（TOCTOU）。鉴于 `AgentRunner` 全程单线程且调用方都在同一事件循环 tick，实际窗口极小，但 API 层无防护。修法：在 `createTask` 内再次检查，或给方法加显式 in-flight 标志。

9. **agents-runner.ts:760** — `acknowledgedIpcOrder` 上限 64 用 `shift()` 弹出头部，单次 O(n)；64 上限下影响可忽略，但若上限调高将退化为 O(n²)。修法：用环形缓冲或双端队列。

10. **agents-view.ts:282-291 vs 806-812** — `dispose()` 与 `close()` 是两条独立清理路径：`close()` 设 `closed=true` 并停 presence 定时器，但**不**取消 `unsubscribeSummary`/`unsubscribeTask`；若宿主只调 `close()` 不调 `dispose()`，store 更新仍会驱动 `refreshTasks`+`requestRender` 渲染已关闭视图。修法：`close()` 内也调 `dispose()` 或合并两条路径。

11. **agents-runner.ts:636-639** — `launch()` 在 `request.sddRemediation && child.pid === undefined` 时调用 `childError`，但此前已执行 `this.live.set(id, live)`（行 604）与 `store.update(... RUNNING ...)`（行 613）；`childError` 走 pid===undefined 分支清理 live 并 `finish(FAILED)`，路径正确，但 `onLaunch` 回调（行 619-624）只在 "spawn" 事件触发，对无 pid 的 spawn 失败不会触发——语义一致，仅注意 `child.on("spawn")` 在 Node 中对 spawn 失败也可能不发（已失败则发 "error"），当前由 `childError` 兜底，无 bug，备注即可。

12. **agents-runner.ts:594-598** — `prepareResponseObservations` 的异步就绪竞态：`ready` 标志由 Promise 回调设置，`observationPreparation()` 同步读取；`checkObservationGrant` 行 803-806 注释明说"只有一次机会；迟到的就绪无法附加"——设计如此，但若 `prepareResponseObservations` 在首个观测检查点之后 resolve true，采集已永久放弃。属文档化行为，非 bug，但值得在 `TaskRequest` 注释中显式标注"同步竞态窗口"。

## agents-runner.ts 拆分建议

文件 1078 行，聚焦 AgentRunner 类（行 407-1064，约 660 行）已可独立成文件，外围三簇纯函数/类型可剥离：

**新文件 1：`lib/agents-runner-remediation.ts`**（约 75 行）
迁移符号：`RemediationHarnessPlan`、`RemediationRollbackPlan`、`RemediationScope`、`RemediationPlan`、`RemediationObservation`、`RemediationObservations`、`concrete`（内部）、`parseRemediationPlan`、`plannedCommands`、`evidenceDigest`（内部）、`observeRemediationTool`、`remediationEvidence`、`REMEDIATION_PLAN_ENV`。
理由：纯数据校验+证据聚合，零 AgentRunner 依赖；`extensions/jero-agents.ts` 已直接导入这些符号，拆出后 import 路径更短。

**新文件 2：`lib/agents-runner-child.ts`**（约 110 行）
迁移符号：`ChildLike`、`SpawnOptions`、`Spawn`、`ProcessControl`、`PiCommand`、`RunnerDeps`、`RunnerLimits`、`AskAnswer`、`TaskQuery`、`ProcessLike`（内部）、`splitCommandLine`、`piCommand`、`childArguments`、`promptText`、`JsonLines`、`abortReasonText`、`MAX_CHILD_RESPONSE_OBSERVATIONS`、`ChildObservationSnapshot`、`ChildObservationBuffer`（内部）。
理由：子进程协议/命令行构造层，与运行器生命周期解耦；`tests/agents-runner.test.ts` 对 `JsonLines`/`piCommand`/`childArguments`/`abortReasonText` 的测试可独立成文件。

**保留在 `lib/agents-runner.ts`**（约 700 行）：`AgentRunner` 类全部、`LiveTask`、`Pending/PendingQuery/PendingReply`、`QUERY_REJECTION_ERRORS`/`QUERY_REJECTION`/`rejectQuery`/`queryRejection`、`hostProcess`、`STDERR_TAIL_MAX`/`CHILD_MARKER`/`IPC_MARKER`/`PARENT_NOTIFICATION_TOOL`/`DEFAULT_TOOLS`/`TERMINATION_GRACE_MS`/`GROUP_CONFIRM_MS`/`GROUP_CONFIRM_DEADLINE_MS`、`SDD_CHANGE_FLAG`、`SddChangeSelection`、`RemediationTerminalFacts`、`TaskRequest`、`RunnerHooks`。
拆分后主文件降至 ~700 行，符合项目模块粒度惯例。

## 死代码清单

1. **agents-view.ts:71** — `export const SESSION_FINISHED_TTL_MS = 15 * 60_000;`：生产代码零消费，仅 `tests/agents-grouping.test.ts` 导入；`inScope` 忽略 `_now` 使 TTL 语义名存实亡。删除需同步删测试断言。
2. **agents-view.ts:471** — `inScope(task, _now)` 的 `_now` 形参：从未使用，删除并同步行 383 调用点（或整个删除行 383）。
3. **agents-view.ts:383** — 死分支（见 P1#6）。
4. **agents-runner.ts:290** — `const DEFAULT_TOOLS: readonly string[] = []`：语义上等价于内联 `[]`；属"过度命名的空数组常量"，非严格死代码。
