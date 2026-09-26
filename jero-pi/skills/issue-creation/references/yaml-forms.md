# YAML Issue Forms 控件处理细则

`jero-issue-creation` 的表单物化细则。正文只保留决策规则，这里承载逐控件处理。

## 表单选择与 schema 读取

- 仅当仓库自带表单的声明用途匹配时才选择它。若多个表单都匹配且策略无法区分，停下来请求该决策。
- 对 YAML 表单，读取其 schema 并按声明顺序（declared order）建立控件。仅支持 `input`, `textarea`, `dropdown`, and `checkboxes`。
- Markdown controls are non-answer guidance: honor their visible instructions when collecting and materializing adjacent answers, but do not render them as response sections.
- Fail closed before mutation on malformed, unsupported, missing, or ambiguous required structure or answers. A malformed schema, or missing or ambiguous required answers, fail closed: do not open a browser or mutate.
- A browser handoff is available only when the user explicitly requests browser completion or a syntactically valid selected form cannot safely/faithfully be represented by the automated path; otherwise report why automation is unsafe and stop.

## 控件处理表

| 控件 | 必需的处理 |
| --- | --- |
| `input` / `textarea` | Preserve the visible label. Require an answer when `validations.required` is true; otherwise render `_No response_`. |
| `dropdown` | Preserve visible labels and options. Require exact selected option text; single-select has one selection, and multi-select preserves selections in declared options order. A required dropdown needs at least one valid selection; an optional dropdown with no selection renders `_No response_`. |
| `checkboxes` | Preserve the visible label and every option as `- [x]` or `- [ ]` in declared order. Enforce individually required checkboxes. For agent-verifiable operational options, proactively complete the action and mark it only with retained evidence; the agent may explicitly attest only its own evidence-backed work and must not attribute its actions to the user. Personal facts, consent, legal declarations, and other first-person user assertions require explicit user affirmation; require explicit first-person affirmation for such user declarations. Do not blanket-check checkboxes: a request to publish does not affirm any checkbox. |

## 渲染

For each answer, render `### <visible label>` followed by its materialized value. For `textarea.attributes.render`, fence the answer with the declared language and a fence long enough for its content. Never invent answers, selections, confirmations, or labels.

Markdown 模板只能基于已知证据填入同一个 private `BODY_FILE`。若无匹配模板，仅当空白 issue 被显式启用时才使用审阅过的结构化空白回退；否则不发布并停止。
