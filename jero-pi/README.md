# jero-pi

**Pi 开发 harness，由 [gentle-pi](https://github.com/Gentleman-Programming/gentle-pi) v2.6.2 全量重构而来。**

> 命名迁移说明：本包为 gentle-pi 的结构化 fork。命令前缀已由 `/gentle:*` 改为 `/jero:*`；
> 与外部 Gentle AI 二进制的集成（安装器、review relay 契约、遥测触发器）保持原始名称，
> 因为它们引用的是上游独立产品的发布物。

## 能力（与上游 v2.6.2 完全一致）

- **SDD/OpenSpec**：explore → proposal → spec → design → tasks → apply → verify → archive 全周期工件管理
- **Strict TDD**：RED → GREEN → TRIANGULATE → REFACTOR 证据链
- **子代理编排**：有界 map/implement/verify 代理，父会话持有最终责任
- **Native review**：冻结候选的风险分级评审与有界修正回路
- **技能发现 / 主题 / 提示词**：Pi 包标准交付物

## 模块结构（本次重构）

```
jero-pi/
├── extensions/        # Pi 扩展入口（jero-ai 主扩展、jero-agents、jero-shell、jero-todo 等）
├── lib/
│   ├── agents/        # 子代理协议、运行器、视图、画像、代理根目录
│   ├── review/        # 原生评审：仓储、锁、快照、事务、同意、策略、宿主中继
│   ├── shell/         # 工作台 UI：侧栏、卡片、变更视图、用量视图、todo
│   ├── metrics/       # 运行时指标（父进程/子进程/投递/策略）
│   ├── sdd/           # SDD 预检、研究能力、状态机 + openspec 增量与护栏
│   ├── native/        # 原生 CLI 包装、选择列表、全屏交互、指针区域
│   └── core/          # 终端主题、模型路由权威、编排器、Gentle AI 二进制集成
├── runtime/           # 由 scripts/build-runtime-modules.mjs 生成的扁平 .mjs 模块
├── assets/            # 代理提示词、链、编排器文档、托管资产迁移清单
├── skills/            # Pi 技能（branch-pr、judgment-day、release 等）
├── contracts/         # review-integration v1/v2 JSON Schema 与夹具
├── openspec/          # 本仓库自身的规格变更史
├── themes/ prompts/ docs/ tests/ scripts/
```

## 开发

```bash
pnpm install --ignore-scripts   # 本地开发安装（跳过二进制下载）

pnpm test                       # 单元测试 + provider contract + runtime harness
pnpm typecheck                  # tsc 诊断基线（只紧不松）
pnpm run check:runtime-modules  # 校验 runtime/*.mjs 与 lib 源一致
```

安装与配置细节见 [技术参考](docs/readme-reference.md)。

## 来源与致谢

- 上游：[Gentleman-Programming/gentle-pi](https://github.com/Gentleman-Programming/gentle-pi)（MIT，作者 Alan Buscaglia）
- gentle-shell™ / gentle-pi™ 为上游商标；本仓库为独立 fork，不隐含官方背书。见 [TRADEMARKS.md](TRADEMARKS.md)。
- 外部 Gentle AI 二进制与其发布通道归 Gentleman Programming 所有，本包仅按其公共契约集成。
