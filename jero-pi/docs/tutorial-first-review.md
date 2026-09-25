# 教程：从安装到第一次通过评审

本教程带你走完 jero-pi 的最小闭环：装包 → 体检 → 做一个小改动 → 认识评审 →
把关键决策存进记忆。全程约 15 分钟。命令与工具的完整清单见
[技术参考](jero-reference.md)；"什么时候该用哪条纪律"见
[how-to 指南](how-to-choose-discipline.md)。

## 0. 前置

- Pi coding-agent ≥ 0.85.1。
- 一个 git 仓库（评审状态存放在 `<git-common-dir>/jero-review/`，随仓库走）。

## 1. 安装与体检

```sh
pi install <jero-pi 包来源>
```

进入任意项目后先跑一次体检：

```
/jero:doctor
```

逐行确认：包资产（agents/chains/support）齐、OpenSpec config（可缺，SDD 才需要）、
全局模型配置有效、记忆工具已激活、精益档位。任何 `fail:` 行都带 remedy 路径。
`/jero:status` 是更精简的总览（persona、lean 档位、模型路由）。

## 2. 做一个小改动，认识 inspect

让 agent 或你自己改几行代码，然后让 agent 调用：

```json
{"operation": "inspect"}
```

`inspect` 是只读预检：报告当前候选是否 START 就绪、有没有未跟踪文件需要选择。
**注意两种结果**：

- 工作树基本干净（空候选或纯文档）时，结果里可能带 `triviality_hint`——
  这是建议而非命令：改动太小，可以先问用户是否值得走完整评审；
  只读的 `{"operation":"assess"}` 是轻量替代，START 仍然随时可用。
- 有真实代码变更时不会有这个提示，按下面的生命周期走。

## 3. 评审生命周期（动词，不是斜杠命令）

评审通过 `jero_review` 工具的操作推进，全部是显式动词：

1. `start`——冻结候选、创建血统。首次会返回**同意信封**：两个 provider 选项 +
   一个宿主常任权限选项（允许本 Pi 会话在该仓库内免重复询问，可随时
   `/jero:review-session-permission revoke` 撤销）。
2. `answer-consent`——恰好一次，只带 `consentBinding` 和 `granted|declined`。
3. 之后按 STATUS 的指示走：四个评审透镜（risk/reliability/resilience/readability）
   经锁定子进程各跑一次 → 发现被冻结分类 → 如有发现，进入**恰一次有界纠正**
   （预算 = `min(200, ceil(原始变更行/2))` 行）→ `validate` 定向校验 →
   确认批准并销毁权威。
4. 维护动词（`recover`/`reconcile-authority` 等）需要显式授权绑定 + 交互批准。

两条铁律，理解了它们就理解了 jero-pi：**评审结果与回执只是信息**——commit、
push、PR 永远遵循普通仓库策略；**模型输出永远是无信托数据**——任何状态
转移都由进程内确定性权威裁决，不经过模型的 prose。

## 4. SDD：多阶段工作才需要

一个改动跨多文件、需要提案-设计-任务分解时：

```
/jero:sdd-preflight      # 会话预检（确认偏好，一次性）
/jero-sdd-init           # 探测技术栈，落 openspec/config.yaml
/jero-sdd-status         # 确定性状态引擎：当前阶段与 next_recommended
/jero-sdd-continue       # 路由到下一阶段
```

产物在 `openspec/changes/<name>/`（proposal/specs/design/tasks/apply/verify/sync）。
每次成功 continue 后，守卫会记录工件的水位（行数 + SHA-256）；若某工件事故性
截断或消失，下一次 continue 会停下来要你显式确认——拒绝则只看状态，文件不动。

## 5. 记忆：跨会话的地基

```
mem_save   topic=sdd/<change>/verify-report  ←阶段产物、决策、修复
mem_search "关键词"                           ←下次会话先搜再重推
```

层级 topic 键（如 `decisions/auth-layout`）+ 轻量索引，纯文件存储。上下文
压缩临近时你会收到告警（可 `JERO_PI_CONTEXT_MONITOR=0` 关闭）；压缩完成后
会有一次提示：用 `mem_search`/`mem_read` 找回关键上下文。

## 6. 下一步

- `/jero:lean status` 看当前精益档位；`/jero:lean ultra` 收紧输出纪律，
  "stop lean" 一句话关闭。
- 高危变更可了解 Judgment Day（显式触发的双盲终审）与 RDD 开关
  （`/jero:review-mode`）。
- 遇到权威状态异常：先 `inspect`，再按 next action 走；绝不手工编辑
  `.git/jero-review/`。
