# jero-pi 技能写作规范

写给要新增、修改或淘汰 `skills/` 目录下技能的贡献者。规范借鉴 mattpocock/skills 的两条核心纪律——**触发措辞双轨制**与**路由器不许撒谎**——以及 superpowers 的行为验证学说（**写技能 = 对流程文档做 TDD**），并结合 jero-pi/pi 宿主的实际机制落地。机器强制项标注 🔒。

## 1. 触发措辞双轨制

jero-pi 的技能由 pi 宿主按 frontmatter `description` **自主触发**，因此每个技能的 description 都是"给模型看的触发语"，不是给人看的广告词：

- **必须**写清触发场景："当用户……时使用"（像 `jero-lean` 那样列举具体触发短语：精简/最小实现/yagni/抱怨过度工程）。
- **禁止**写成营销句子或只写功能清单——模型靠它判断"现在该不该加载我"。
- **禁止**在 description 里总结技能流程：实测中模型会用摘要代替读正文，导致正文流程被跳步。description 只回答"何时加载我"，"怎么做"只活在正文里。
- 需要人工显式触发的流程入口不要做成技能，做成 `prompts/*.md` 斜杠命令（如 `/agents-init`、`/skill-creation`），frontmatter 带 `argument-hint` 与 `$ARGUMENTS` 插值。

## 2. 命名与前缀 🔒

`tests/skill-collision-prefixes.test.ts` 钉住命名规则：

- 11 个目录（`branch-pr`、`chained-pr`、`cognitive-doc-design`、`comment-writer`、`issue-creation`、`judgment-day`、`rdd-defect-workflow`、`skill-creator`、`skill-improver`、`skill-registry`、`work-unit-commits`）的 frontmatter `name` **必须**带 `jero-` 前缀，且与目录名一一对应；
- `jero-ai` 与 `release` 保持裸名，**不得**加前缀；
- 新增技能优先采用 `jero-` 前缀 + 同名目录，避免与生态内其他技能集冲突。

## 3. 渐进披露

- SKILL.md 正文保持短（参考：`jero-lean` 的完整梯子也只占一屏）；细则、模板、大表格放技能目录内的平铺参考文件或 `references/`，正文里写明"需要时读取"。
- 跨技能共享的契约文档放 `skills/_shared/`（注册表扫描会排除它）。

## 4. 生命周期三档

在 frontmatter `metadata.tier` 标注（缺省为 `core`）：

| 档 | 含义 | 约束 |
|---|---|---|
| `core` | 随包正式能力 | 进 `docs/jero-reference.md` 技能清单与 `jero-skills` 路由表 |
| `experimental` | 公开收集反馈，可能随时废弃 | `metadata.tier: experimental`；description 注明实验性 |
| 已淘汰 | 直接删除 | CHANGELOG 必须点名替代品，不留空目录 |

## 5. 行为验证：写技能 = 对流程文档做 TDD

技能是塑造 agent 行为的代码，不是散文。**没有观察到的失败，就没有技能改动**——新增与编辑同等适用。iron rule：先有失败基线，再有最小修法，再重测。

1. **RED（加压场景）**：构造一个让目标行为失败的场景——时间压力（"生产在宕机"）、权威压力（"经理让你跳过"）、规模压力（"就改一行"）——在**无技能（或改前）**基线上运行，逐字记录失败形状与模型的合理化借口（"这次很特殊"、"用户肯定不在意"）。借口逐字保留，它们是下一条的输入。
2. **GREEN（最小修法）**：只针对记录到的失败写内容。每条合理化借口配一条显式反制，写成对照表（"念头 → 现实"），不要写泛泛的鼓励。
3. **形状匹配**：按失败形状选配方，用错形状会适得其反——
   | 失败形状 | 配方 | 反例 |
   |---|---|---|
   | 压力下跳过规则 | 禁令 + 合理化对照表 + 红旗清单 | 只讲道理 |
   | 输出形状错 | **正面配方**（只说该做什么） | 禁令——实测比无指导更糟 |
   | 漏掉必需元素 | 模板 REQUIRED 槽位 | 散文提醒 |
   | 行为应随条件变化 | 可观察谓词的条件句 | 含糊的程度词 |
4. **微测**：措辞级修改也要重测。每变体至少 5 次、必带无指导对照；**方差本身就是指标**——时灵时不灵的措辞比稳定的次优措辞危险。
5. **红线**：获胜配方**不加 nuance 子句**（加一条就从稳定变噪）；不写叙事式长示例；不批量改技能不逐个测。
6. **证据落盘**：加压场景与 before/after 记录放技能目录 `pressure/` 子目录（注册表只认 `*/SKILL.md`，不扫描子目录）；跨技能行为回归用 `benchmarks/` 多臂对照（安全校验臂防"砍守卫赢指标"）。

## 6. 跨技能调用措辞

技能内引用其他技能时，写"调用 Skill 工具并点名 `<name>`"或"使用 `/命令`"——**禁止**写 `../other-skill/SKILL.md` 之类的相对路径链接（宿主不是按路径发现技能的）。

## 7. 新增/修改技能检查清单

1. frontmatter：`name` 与目录名满足 §2 🔒；`description` 是触发语（§1）。
2. 正文短，细则外置（§3）；需要共享契约的放 `_shared/`。
3. 标注 `metadata.tier`（§4）。
4. 行为验证（§5）：失败基线 → 最小修法 → 重测证据放 `pressure/`；措辞修改附微测结论。
5. **更新 `skills/jero-skills/SKILL.md` 路由表**——不更新就是让路由器撒谎。
6. 更新 `docs/jero-reference.md` 的技能清单与数量。
7. 若技能文件是包完整性的一部分，把路径加进 `scripts/verify-package-files.mjs` 的 requiredPaths。
8. 跑 `/skill-registry:refresh` 或依赖扩展的自动重扫，确认 `.atl/skill-registry.md` 收录。
