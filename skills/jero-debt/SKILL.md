---
name: jero-debt
description: "精益债务台账（lean debt ledger）：扫描全库的 `jero:` 简化标记，列出每笔有意的妥协及其天花板与升级触发条件；没有升级路径的标记记为 no-trigger。当用户要求列出快捷方式/技术债/精益标记、问“之前简化掉了什么”或提到债务台账时使用。只报告，不修改代码。"
---

# Jero 债务台账（Lean Debt Ledger）

每次有意的简化都留下一个 `jero:` 标记（见 `jero-lean` 技能）。本技能收割这些标记，形成可审计的债务台账。只报告，不修改任何代码。

## 扫描

```sh
grep -rnE '(#|//|<!--|--) ?jero:' . --exclude-dir=node_modules --exclude-dir=.git
```

再按技术栈补充注释前缀（如 `--` 之于 SQL、`;` 之于 Lisp 系）；跳过 `node_modules`、`.git`、构建产物目录，以及 OpenSpec/文档目录中处于散文位置的匹配（标记必须位于注释内才算数）。

## 输出格式

每个标记一行：

```text
<file>:<line>, <简化了什么>. ceiling: <天花板>. upgrade: <触发条件>.
```

标记里缺少 `upgrade:` 触发条件的，追加 no-trigger 标签——没有重启条件的妥协是会悄悄烂掉的债，应优先补上触发条件或还清。

## 收尾

```text
<N> markers, <M> with no trigger.
```

没有任何标记时：

```text
No jero: debt. Clean ledger.
```

用户明确要求持久化时才写出（如 `JERO-DEBT.md`）；否则只报告。
