---
name: jero-issue-creation
description: "基于仓库证据创建并分诊 GitHub issue。触发词：创建 issue、缺陷报告、功能请求或 issue 审批。"
license: Apache-2.0
metadata:
  author: gentleman-programming
  version: "1.4"
---

# Issue 创建

## 核心规则

在提出或发布之前，先弄清目标仓库的贡献工作流。YAML Issue Forms are the format authority for the default automated path: materialize reviewed answers into a private `BODY_FILE` and publish with `--body-file`（默认自动化路径以 YAML Issue 表单为格式权威：把审阅过的答案落成私有 `BODY_FILE`，用 `--body-file` 发布）。逐控件物化细则见 `references/yaml-forms.md`，临时目录/发布/回读脚本见 `references/private-body-files.md`。

## 安全探测

先执行只读检查：

```bash
gh auth status
REPO="$(gh repo view --json nameWithOwner -q .nameWithOwner)"
REPO_URL="$(gh repo view --json url -q .url)"
HOST="${REPO_URL#*://}"
HOST="${HOST%%/*}"
TARGET="$HOST/$REPO"
gh repo view --json nameWithOwner,url,hasDiscussionsEnabled,hasIssuesEnabled,isBlankIssuesEnabled
git ls-files README.md CONTRIBUTING.md CONTRIBUTING.* .github/CONTRIBUTING.md .github/ISSUE_TEMPLATE .github/ISSUE_TEMPLATE/config.yml
gh api --hostname "$HOST" --paginate "repos/$REPO/labels?per_page=100" --jq '.[].name'
```

检查 `README.md`、贡献说明、`.github/ISSUE_TEMPLATE/config.yml` 的联系链接、表单、标签以及开放与已关闭的 issue。对 questions/support（疑问/支持）类请求，优先遵循仓库规定的 Discussions/contact routing（Discussions/联系路由）；otherwise ask or stop（否则询问或停止）。完成对 `REPO`、`HOST` 与 `TARGET` 的 target verification（目标核验）。当认证、目标核验、issue 可用性、策略、表单选择或必需元数据缺失或含糊时，在变更前保守失败（fail closed）。仅当 `isBlankIssuesEnabled` 明确为 true 时才允许空白回退。

仅用已审阅、且策略允许该执行者添加的标签构建 `LABEL_ARGS`：

```bash
LABEL_ARGS=()
LABEL_ARGS+=(--label "$LABEL") # Repeat only for each permitted discovered label.
```

## 查重与表单决策

1. 用一句话描述报告并推导 `QUERY`，然后在开放与已关闭的 issue 上完整做一次 duplicate search（查重搜索）：

   ```bash
   gh issue list --repo "$TARGET" --state all --search "$QUERY" --limit 1000
   ```

   The agent must complete the duplicate search proactively and retain evidence of its result. If results are saturated or completeness is uncertain, narrow the read-only search or stop. Comment on a confirmed duplicate instead of creating one. Before commenting on a confirmed duplicate, perform the same privacy scan/redaction on the exact comment body as for publication.
2. 表单选择、schema 读取与逐控件物化按 `references/yaml-forms.md` 执行；任何畸形/不支持/缺失/歧义的必需结构或答案都在变更前保守失败。

## 审阅与发布

在唯一一次创建尝试之前，审阅目标、标题、所选表单或允许的回退、确切正文与 permitted labels（允许的标签）。The agent must complete the privacy scan/redaction of the exact body immediately before publication and retain evidence of it: replace private project names, usernames, hostnames, home paths, credentials, and private network addresses with useful placeholders without removing reproduction structure.

临时目录纪律、发布命令与 target-host read-back（目标宿主回读）按 `references/private-body-files.md` 执行；只有完成回读后才报告 `confirmed`。

## 分诊

在批准或关闭 issue 之前，核实它具体、非重复、证据充分、在范围内，且与仓库标签/状态策略一致。若有任何一点不确定，保留仓库评审状态并请求最小的缺失证据。
