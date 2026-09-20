# 编排器——记忆细则（懒加载）

仅绑定到父 Pi 会话，用于 SDD 阶段的记忆读/写。非常驻；按 `assets/orchestrator.md` 的记忆契约指针按需加载。

### SDD 阶段

每个 SDD 阶段子代理直接从活动后端读取自己的必需输入；父会话传递产物引用（主题键或文件路径），而非内容本身。阶段子代理在返回前持久化其产物。

| 阶段          | 读取                                                   | 写入           |
| -------------- | ------------------------------------------------------- | ---------------- |
| `sdd-explore`  | 无                                                 | `explore`        |
| `sdd-research` | exploration                                             | `research` + `preproposal` |
| `sdd-proposal` | exploration（可选）                                  | `proposal`       |
| `sdd-spec`     | proposal（必需）                                     | `spec`           |
| `sdd-design`   | proposal（必需）                                     | `design`         |
| `sdd-tasks`    | spec + design（必需）                                | `tasks`          |
| `sdd-apply`    | tasks + spec + design + `apply-progress`（若存在） | `apply-progress` |
| `sdd-verify`   | spec + tasks + `apply-progress`                         | `verify-report`  |
| `sdd-sync`     | proposal + spec + design + tasks + `verify-report`      | `sync-report`    |
| `sdd-archive`  | 全部产物                                           | `archive-report` |
| `sdd-status`   | 变更产物（只读）                            | 无          |

- SDD 产物键：在 memory/hybrid 模式下，阶段产物使用稳定主题键，如 `sdd/<change>/proposal`、`sdd/<change>/spec`、`sdd/<change>/design`、`sdd/<change>/tasks`、`sdd/<change>/apply-progress`、`sdd/<change>/verify-report`、`sdd/<change>/sync-report` 与 `sdd/<change>/archive-report`。
- 选中可选研究车道时，`sdd-research` 使用附加主题键 `sdd/<change>/research` 与 `sdd/<change>/preproposal`（openspec：`openspec/changes/<change>/research.md`）。
- 若记忆工具不可用，不要假装存在持久化；内联返回产物和/或写 OpenSpec 文件。

记忆生命周期规则（jero-pi 内置记忆无生命周期工具）：

- jero-pi 的 `mem_*` 存储不携带评审生命周期元数据或工具：每个主题持有带 `saved_at` frontmatter 的单一快照，再次保存同一主题即替换该条目（last write wins）。
- 在会话开始或架构敏感工作之前，用 `mem_list` 列出当前项目的主题（例如前缀 `sdd/<change>/`），使过期上下文在被依赖前可见。
- 条目只与其 `saved_at` 戳及其背后的证据一样新。把过时记忆当作过期上下文，而非可信事实。
- 当检索到的记忆相对手头工作显得过时时，向用户呈现该过期上下文，并在依赖它之前对照当前证据验证。
- 不存在 `mark_reviewed` 动作，也没有记忆维护命令；绝不声称已标记、评审、提升或过期某个记忆条目。
