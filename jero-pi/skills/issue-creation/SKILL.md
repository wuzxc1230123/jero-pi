---
name: jero-issue-creation
description: "基于仓库证据创建并分诊 GitHub issue。触发词：创建 issue、缺陷报告、功能请求或 issue 审批。"
license: Apache-2.0
metadata:
  author: gentleman-programming
  version: "1.3"
---

# Issue 创建

## 核心规则

在提出或发布之前，先弄清目标仓库的贡献工作流。YAML Issue Forms are the format authority for the default automated path: materialize reviewed answers into a private `BODY_FILE` and publish with `--body-file`.（默认自动化路径以 YAML Issue 表单为格式权威：把审阅过的答案落成私有 `BODY_FILE`，用 `--body-file` 发布。）

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
2. 仅当仓库自带表单的声明用途匹配时才选择它。若多个表单都匹配且策略无法区分，停下来请求该决策。
3. 对 YAML 表单，读取其 schema 并按声明顺序（declared order）建立控件。仅支持 `input`, `textarea`, `dropdown`, and `checkboxes`。Markdown controls are non-answer guidance: honor their visible instructions when collecting and materializing adjacent answers, but do not render them as response sections. Fail closed before mutation on malformed, unsupported, missing, or ambiguous required structure or answers. A malformed schema, or missing or ambiguous required answers, fail closed: do not open a browser or mutate. A browser handoff is available only when the user explicitly requests browser completion or a syntactically valid selected form cannot safely/faithfully be represented by the automated path; otherwise report why automation is unsafe and stop.

| 控件 | 必需的处理 |
| --- | --- |
| `input` / `textarea` | Preserve the visible label. Require an answer when `validations.required` is true; otherwise render `_No response_`. |
| `dropdown` | Preserve visible labels and options. Require exact selected option text; single-select has one selection, and multi-select preserves selections in declared options order. A required dropdown needs at least one valid selection; an optional dropdown with no selection renders `_No response_`. |
| `checkboxes` | Preserve the visible label and every option as `- [x]` or `- [ ]` in declared order. Enforce individually required checkboxes. For agent-verifiable operational options, proactively complete the action and mark it only with retained evidence; the agent may explicitly attest only its own evidence-backed work and must not attribute its actions to the user. Personal facts, consent, legal declarations, and other first-person user assertions require explicit user affirmation; require explicit first-person affirmation for such user declarations. Do not blanket-check checkboxes: a request to publish does not affirm any checkbox. |

For each answer, render `### <visible label>` followed by its materialized value. For `textarea.attributes.render`, fence the answer with the declared language and a fence long enough for its content. Never invent answers, selections, confirmations, or labels.

Markdown 模板只能基于已知证据填入同一个 private `BODY_FILE`。若无匹配模板，仅当空白 issue 被显式启用时才使用审阅过的结构化空白回退；否则不发布并停止。

## 审阅与发布

在唯一一次创建尝试之前，审阅目标、标题、所选表单或允许的回退、确切正文与 permitted labels（允许的标签）。The agent must complete the privacy scan/redaction of the exact body immediately before publication and retain evidence of it: replace private project names, usernames, hostnames, home paths, credentials, and private network addresses with useful placeholders without removing reproduction structure.

在仓库外创建一个仅属主所有的临时目录来存放这两个私有文件；将其权限限制为当前用户，并在每次退出/结局时清理这两个文件：

```bash
umask 077
REPO_ROOT="$(git rev-parse --show-toplevel)" || exit 1
REPO_ROOT="$(cd "$REPO_ROOT" && pwd -P)" || exit 1
if [ "$REPO_ROOT" = "/" ]; then
  printf '%s\n' "Temporary directory is inside the repository" >&2; exit 1
fi
TMP_DIR="$(TMPDIR=/tmp mktemp -d /tmp/gentle-ai-issue.XXXXXXXX)" || exit 1
trap 'rm -rf -- "$TMP_DIR"' EXIT
TMP_DIR_REAL="$(cd "$TMP_DIR" && pwd -P)" || exit 1
case "$TMP_DIR_REAL/" in
  "$REPO_ROOT/"*) printf '%s\n' "Temporary directory is inside the repository" >&2; exit 1 ;;
esac
chmod 700 "$TMP_DIR_REAL"
BODY_FILE="$TMP_DIR_REAL/body.md"
READBACK_FILE="$TMP_DIR_REAL/readback.json"
```

通过自动化路径做恰好 one mutation attempt（一次变更尝试）并只发布一次：

```bash
gh issue create --repo "$TARGET" --title "$TITLE" --body-file "$BODY_FILE" "${LABEL_ARGS[@]}"
```

当上述表单决策允许浏览器补全时，可选的、单独的 browser handoff（浏览器交接）可以打开仓库表单。It is never proof of publication and is never a response to malformed schemas or missing/ambiguous required answers:

```bash
gh issue create --repo "$TARGET" --web
```

对超时、网络故障、身份缺失或其他不确定结果，不要重试。捕获返回的 issue 编号，然后在报告成功之前从已核验的目标宿主回读它：

```bash
gh issue view "$NUMBER" --repo "$TARGET" --json number,url,title,body,state,labels >"$READBACK_FILE"
```

确认回读指向目标宿主上的 issue，且标题与正文仅在 CRLF 转 LF 与末尾换行规范化之后一致。只有完成这次 target-host read-back（目标宿主回读）后才报告 `confirmed`。否则，当权威拒绝证明没有创建任何 issue 时报告 `no_write`，或报告 `unknown` 并停止后续一切变更。

## 分诊

在批准或关闭 issue 之前，核实它具体、非重复、证据充分、在范围内，且与仓库标签/状态策略一致。若有任何一点不确定，保留仓库评审状态并请求最小的缺失证据。
