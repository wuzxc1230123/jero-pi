---
name: jero-issue-creation
description: "基于仓库证据创建并分诊 GitHub issue。触发词：创建 issue、缺陷报告、功能请求或 issue 审批。"
license: Apache-2.0
metadata:
  author: jero-pi
  version: "1.5"
---

# Issue 创建

## 核心规则

在提出或发布之前，先弄清目标仓库的贡献工作流。默认自动化路径以 YAML Issue 表单（YAML Issue Forms）为格式权威：把审阅过的答案物化进私有 `BODY_FILE`，用 `--body-file` 发布。逐控件物化细则见 `references/yaml-forms.md`，临时目录/发布/回读脚本见 `references/private-body-files.md`。

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

检查 `README.md`、贡献说明、`.github/ISSUE_TEMPLATE/config.yml` 的联系链接、表单、标签以及开放与已关闭的 issue。对 questions/support（疑问/支持）类请求，优先遵循仓库规定的 Discussions/联系路由（Discussions/contact routing）；否则询问或停止。完成对 `REPO`、`HOST` 与 `TARGET` 的目标核验（target verification）。当认证、目标核验、issue 可用性、策略、表单选择或必需元数据缺失或含糊时，在变更前保守失败（fail closed）。仅当 `isBlankIssuesEnabled` 明确为 true 时才允许空白回退。

仅用已审阅、且策略允许该执行者添加的标签构建 `LABEL_ARGS`：

```bash
LABEL_ARGS=()
LABEL_ARGS+=(--label "$LABEL") # Repeat only for each permitted discovered label.
```

## 查重与表单决策

1. 用一句话描述报告并推导 `QUERY`，然后在开放与已关闭的 issue 上完整做一次查重搜索（duplicate search）：

   ```bash
   gh issue list --repo "$TARGET" --state all --search "$QUERY" --limit 1000
   ```

   代理必须主动完成查重搜索并保留其结果证据。若结果饱和或完整性不确定，收窄只读搜索或停止。对已确认的重复项做评论而不是再建一个。对已确认重复项评论之前，对确切评论正文执行与发布相同的隐私扫描/脱敏（privacy scan/redaction）。
2. 表单选择、schema 读取与逐控件物化按 `references/yaml-forms.md` 执行；任何畸形/不支持/缺失/歧义的必需结构或答案都在变更前保守失败。

## 审阅与发布

在唯一一次创建尝试之前，审阅目标、标题、所选表单或允许的回退、确切正文与允许的标签（permitted labels）。代理必须在发布前一刻完成对确切正文的隐私扫描/脱敏并保留其证据：把私有项目名、用户名、主机名、home 路径、凭据与私有网络地址替换为有用的占位符，同时不破坏复现结构。

临时目录纪律、发布命令与 target-host read-back（目标宿主回读）按 `references/private-body-files.md` 执行；只有完成回读后才报告 `confirmed`。

## 正文耐用性

Issue 正文会在数天或数周后被维护者或代理消费，代码在此期间会漂移。撰写正文时：

- 描述行为契约与观察到的症状，不描述实现位置——不引用行号；文件路径仅在复现步骤必需时给出。
- 验收/完成标准写成独立可核验的条目（可运行命令或可观察行为），不写"修复后应正常工作"这类无法判定的说法。
- 显式列出范围外：明确不要求处理的相关问题，防止接手方顺带扩面。
- 以上与 `references/yaml-forms.md` 的控件物化叠加适用，不替代表单结构。

## 分诊

在批准或关闭 issue 之前，核实它具体、非重复、证据充分、在范围内，且与仓库标签/状态策略一致。若有任何一点不确定，保留仓库评审状态并请求最小的缺失证据。
