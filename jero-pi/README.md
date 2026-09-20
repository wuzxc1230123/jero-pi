# jero-pi

Pi coding-agent 扩展包，从 gentle-pi v2.7.0 重构而来（见仓库根 `JERO-PI-DESIGN.md`）。

**当前状态：P5 完成（发布准备）。** 评审全生命周期进程内闭环（START→consent→relay 评审→冻结/分类→纠正→校验闭包→燃烧→维护）；身份全量 jero（env/命令/文件名/契约串/技能/资产/主题/清单）。核心差异：

- 零原生二进制：无 postinstall 下载，评审权威为进程内 `lib/authority/`（P2）
- 自研持久记忆 `lib/memory/` + `mem_*` 工具（P3）
- 生态插件强制依赖化（P4）；身份全量迁移 gentle→jero（P5）

> 移植纪律：包身份从出生即 `jero-pi`；P5 身份迁移已完成——上游命名仅存于
> 白名单（wire 金向量词汇、外来存储探测名、legacy 回退读、历史 fixture、
> 上游参考文档），见 `docs/jero-reference.md` 与 `_tools/` 记录。

## 开发

```sh
pnpm install
pnpm test            # 单测 + runtime harness
pnpm typecheck       # 诊断棘轮（scripts/types-baseline.json）
pnpm run check:runtime-modules
```

参考实现库 `../gentle-pi-main/` 为只读，严禁修改或在其内安装依赖。

技术参考：docs/jero-reference.md；上游历史参考：docs/readme-reference.md（gentle-pi v2.7.0 原貌，仅作事实来源）、docs/native-authority-architecture.md 与 docs/review-integration.md（描述已退役的二进制权威架构/契约镜像，review-integration.md 为字节钉住的契约镜像）：[docs/jero-reference.md](docs/jero-reference.md)
