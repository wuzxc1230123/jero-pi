# jero-pi

Pi coding-agent 扩展包，从 gentle-pi v2.7.0 重构而来（见仓库根 `JERO-PI-DESIGN.md`）。

**当前状态：绿地组装中（P1 阶段）。** 核心差异：

- 零原生二进制：无 postinstall 下载，评审权威为进程内 `lib/authority/`（P2）
- 自研持久记忆 `lib/memory/` + `mem_*` 工具（P3）
- 生态插件强制依赖化（P4）；身份全量迁移 gentle→jero（P5）

> 移植纪律：包身份从出生即 `jero-pi`；移植模块内部暂保留上游 gentle 命名
> （文件名/命令/env/schema 前缀），P5 阶段统一机械改名。

## 开发

```sh
pnpm install
pnpm test            # 单测 + runtime harness
pnpm typecheck       # 诊断棘轮（scripts/types-baseline.json）
pnpm run check:runtime-modules
```

参考实现库 `../gentle-pi-main/` 为只读，严禁修改或在其内安装依赖。

上游能力参考（暂为原版文档，P5 重写）：[docs/readme-reference.md](docs/readme-reference.md)
