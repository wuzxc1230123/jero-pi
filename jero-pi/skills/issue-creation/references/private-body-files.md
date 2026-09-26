# 私有 BODY_FILE 与发布脚本细则

`jero-issue-creation` 的临时文件纪律与发布/回读命令。正文只保留规则，这里承载脚本。

## 仅属主所有的临时目录

在仓库外创建一个仅属主所有的临时目录来存放私有文件；将其权限限制为当前用户，并在每次退出/结局时清理：

```bash
umask 077
REPO_ROOT="$(git rev-parse --show-toplevel)" || exit 1
REPO_ROOT="$(cd "$REPO_ROOT" && pwd -P)" || exit 1
if [ "$REPO_ROOT" = "/" ]; then
  printf '%s\n' "Temporary directory is inside the repository" >&2; exit 1
fi
TMP_DIR="$(TMPDIR=/tmp mktemp -d /tmp/jero-issue.XXXXXXXX)" || exit 1
trap 'rm -rf -- "$TMP_DIR"' EXIT
TMP_DIR_REAL="$(cd "$TMP_DIR" && pwd -P)" || exit 1
case "$TMP_DIR_REAL/" in
  "$REPO_ROOT/"*) printf '%s\n' "Temporary directory is inside the repository" >&2; exit 1 ;;
esac
chmod 700 "$TMP_DIR_REAL"
BODY_FILE="$TMP_DIR_REAL/body.md"
READBACK_FILE="$TMP_DIR_REAL/readback.json"
```

## 发布与目标宿主回读

通过自动化路径做恰好 one mutation attempt（一次变更尝试）并只发布一次：

```bash
gh issue create --repo "$TARGET" --title "$TITLE" --body-file "$BODY_FILE" "${LABEL_ARGS[@]}"
```

当表单决策允许浏览器补全时，可选的、单独的 browser handoff（浏览器交接）可以打开仓库表单。It is never proof of publication and is never a response to malformed schemas or missing/ambiguous required answers:

```bash
gh issue create --repo "$TARGET" --web
```

对超时、网络故障、身份缺失或其他不确定结果，不要重试。捕获返回的 issue 编号，然后在报告成功之前从已核验的目标宿主回读它：

```bash
gh issue view "$NUMBER" --repo "$TARGET" --json number,url,title,body,state,labels >"$READBACK_FILE"
```

确认回读指向目标宿主上的 issue，且标题与正文仅在 CRLF 转 LF 与末尾换行规范化之后一致。只有完成这次 target-host read-back（目标宿主回读）后才报告 `confirmed`。否则，当权威拒绝证明没有创建任何 issue 时报告 `no_write`，或报告 `unknown` 并停止后续一切变更。
