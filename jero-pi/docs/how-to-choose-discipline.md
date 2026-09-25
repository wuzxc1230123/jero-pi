# How-to：给这次改动选对纪律档位

jero-pi 的纪律不是一层，而是三根可独立调节的轴：**评审**（改完之后谁来把关）、
**SDD**（动手之前要不要提案-设计-任务分解）、**精益**（输出量约束）。选对档位
的核心问题只有一个：**这次改动的不可逆性和影响面有多大？**

## 评审轴：从重到轻

| 场景 | 用什么 |
|---|---|
| 高危/敏感路径（认证、支付、shell、更新器）、大范围重构 | 完整评审生命周期：`inspect → start → … → validate`。高危可再叠加 Judgment Day（显式触发的双盲终审） |
| 委派给子代理的一次实现，想知道要不要单独评审 | `{"operation":"assess"}`——只读、不建血统，按风险与 writer 档位返回计划（writerSelfVerification / structuralReadbackOnly / independentVerifier） |
| 改动很小（inspect 结果带 `triviality_hint`） | 先问用户。值得审就走完整生命周期；不值得就记录决定。hint 只是建议，不是放行 |
| 用户明确不想被评审打断（如原型冲刺） | `/jero:review-mode disable`（RDD 开关，用户所有，自动化从不改它） |

关键认知：**轻量路径是设计出来的，不是漏洞**。assess 的 writerSelfVerification
on-path 只在"本候选评审已关闭（closed）"时成立；评审被拒绝或不可用时，风险
门控立即回到 RDD off 的完整计划——拒绝一次评审永远不会降低后续标准。

## SDD 轴：阶段数跟着不可逆性走

- **单文件、可逆、一分钟重做**：不用 SDD。写码 → 视风险选评审轴。
- **跨文件但方向明确**：`/jero-sdd-init` 落 tasks.md 即可，design/proposal 从简。
- **方向未定或多人/多次会话推进**：完整七阶段（proposal → spec → design →
  tasks → apply → verify → sync）。阶段引擎的 `next_recommended` 是确定性的，
  不靠模型自觉；`/jero-sdd-continue` 推进时有工件收缩守卫兜底。

判断口诀：**如果做错了需要"考古"才能恢复，就用 SDD；否则评审轴就够了。**

## 精益轴：管输出的量，不管必要性

`/jero:lean` 四档（会话级，切换即时生效）：

- `off`——逐字节还原历史行为（无任何注入）。
- `lite`——完整实现不裁剪，交付时一行点名更精简的替代方案。
- `full`（默认）——七级梯子（需要存在吗 → 已有吗 → stdlib → …）+ 绝不裁剪
  清单（信任边界校验/防数据丢失/安全/可访问性/用户明确要求）。
- `ultra`——full 全部 + YAGNI 极端主义（删除优先于新增）。

精益与评审正交：预算管工作切片（400 行），梯子管必要性，绝不是代码高尔夫。
被裁掉的能力留 `jero: ceiling:` + `upgrade:` 标记，`jero-debt` 技能收割台账。

## 上下文与记忆

- 长会话接近压缩阈值会收到逐档告警（70%/85%/93%；`JERO_PI_CONTEXT_MONITOR=0`
  关闭）。收到告警先把关键状态 `mem_save`，再继续。
- 压缩完成后用 `mem_search`/`mem_read` 找回上下文，而不是让模型重新推导。

## 组合速查

| 任务 | 推荐组合 |
|---|---|
| 改一行文档 | lean 默认，无评审（passive 候选 assess 即可） |
| 修一个 bug + 补测试 | lean full；修完 `assess` 决定是否走评审 |
| 新增一个带鉴权的 API | SDD 完整七阶段 + 完整评审生命周期 |
| 原型冲刺（一次性代码） | `/jero:review-mode disable` + lean lite，结束后恢复 |
