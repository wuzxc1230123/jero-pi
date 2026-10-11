# 威胁建模与依赖面（security-architecture）

> 来源：cc-skills-golang security/architecture 篇（MIT）蒸馏（STRIDE/DREAD 法门）；权威级：建议
> 最低 Go 版本：1.22 ｜ 核验日期：2026-10 ｜ 授权账本：`_sources.md`

## 轻量威胁建模（改动时过一遍）

STRIDE 六问对新暴露面各问一次（S 仿冒/T 篡改/R 抵赖/I 信息泄漏/D
 拒绝服务/E 越权）：

```
这次改动引入/暴露了什么新输入？ → 谁能触达它（信任边界外是谁）？
→ 最坏情况（数据？停机？横向移动？）→ 现有的缓解在哪一层？
→ 缓解被绕过的下一层是什么？
```

- 产出不是文档巨著，是设计/评审里的显式段落（安全敏感变更在 SDD
  设计阶段有 Threat Model 节——本参考是它的取材面）。
- DREAD 排序（危害/再现/可利用/受影响用户/可发现性）用于修复顺序，
  不是精确评分——排序粗粒度即可。

## 信任边界

- 每个外部输入点（HTTP handler / 消息消费者 / 文件导入 / CLI 参数）
  是边界：边界外数据先校验后信任、错误信息不回内部细节（栈/SQL/路径）。
- 服务间调用：内网 ≠ 可信（零信任默认）；服务间鉴权与用户鉴权分开
  建模。
- 配置与凭证是边界输入：不可解析/缺失时 fail-closed（拒绝启动优于
  带默认值运行）。

## 依赖面（供应链）

- `govulncheck ./...`：只报调用路径可达的漏洞（符号级），CI 定期跑；
  GOVULNDB 数据库日更。升级是第一修复路径；无法升级的记录补偿措施
  （WAF 规则/配置面关闭）与退出时间。
- 引入前审查（依赖四问见 dependency-management）：传递依赖数
  （`go mod graph | wc -l`）、维护活跃度、已披露漏洞史、install
  script 类钩子（npm 形态的风险在 Go 侧主要是 cgo 与 build 指令——
  `go build` 不跑任意代码，但 Makefile/taskfile 会）。
- 私有代理（GOPROXY 校验和校验）：go.sum 的校验和矩阵防篡改，
  `GONOSUMDB`/`GOPRIVATE` 豁免要窄。

## 日志与可观测的安全面

- 敏感字段脱敏清单（logging-slog）；日志注入（换行/ANSI 转义）在
  写入前清洗或结构化。
- pprof endpoint 不暴露公网（见 pprof-profiling）；debug 端点统一
  归内网面。

## 错误响应纪律

- API 错误体：稳定错误码 + 人话消息；不回传 panic 栈、SQL、内部
  路径、第三方响应原文。
- 5xx 与 4xx 的信息面差异：4xx 可以带字段级细节（帮用户改对），
  5xx 只说"内部错误"（细节进日志带 trace ID 关联）。

## 审计清单（安全敏感 PR 过一遍）

1. 新输入点都过校验？错误响应无内部泄漏？
2. 密码学面只用了选型表里的原语（security-injection-crypto）？
3. 新依赖过了四问 + vulncheck？
4. secrets 无新增硬编码（`gitleaks` 类扫描在 CI）？
5. 权限判断在新路径上仍然生效（越权回归）？
