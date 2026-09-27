# 领域访谈清单（jero-module-creator 第 1 步）

逐项收集，答不全的项如实标注"未知"并降级处理，不编造。

## 1. 标记文件（门控词的仓库侧）

- 这个领域的仓库**一定**有哪些文件/目录？（用精确名：`project.godot`、`pom.xml`、`go.mod`、`*.csproj`、`Assets/`）
- 与已装模块的标记集合是否互斥？有交集就必须收窄（例如按 `ProjectSettings/ProjectVersion.txt` 区分 Unity 与纯 .NET）。

## 2. 任务词（门控词的会话侧）

- 用户/任务会说什么词？（`Godot`、`场景`、`节点`、`信号`、`MonoBehaviour`……）
- 列 3–6 个高频词，宁精勿滥。

## 3. 命令（钉进 config.yaml 的候选）

- 构建/测试/lint/format 各用什么命令？包管理器是什么？
- 每条命令**在目标项目实际跑通一次**再钉。跑不通的写进 references 说明手动路径，不钉。
- 引擎测试是否需要编辑器实例？（Unity 批处理、Godot headless）→ 需要则建议 Makefile 包装钉 `make test`。
- 测试策略：领域逻辑能否与引擎解耦走纯语言测试？（Godot/C# 的 `dotnet test` 形态）→ 能则优先解耦方案，写进 references。

## 4. 惯例知识来源（references 的素材）

- 官方文档/风格指南的权威链接（写进 references 供子代理按需读）。
- 团队特有惯例（命名、目录、程序集划分）。
- 缓存目录/生成物清单（必须进 `.gitignore` 的：`.godot/`、`Library/`、`Temp/`、`obj/`……）——评审走 git 对象，忽略不干净会拖慢全链路。

## 5. 评审关注点（reviewer 代理的规则素材）

- 该领域最危险的 3–5 类缺陷模式（按严重度排，第一条应是 BLOCKER 级）。
- 引擎/框架生命周期陷阱、资源泄漏、误用 API。

## 6. 角色判断（生成哪些代理）

- 评审代理：必建（用关注点填 reviewer 模板）。
- 设计代理：仅当领域有独立的设计活动（玩法设计、系统拆解）才建。
- 执行代理：**永不建**（jero-worker + 技能注入覆盖）。

## 7. 命名

- 定一个领域词元（一个词：`godot`、`java`、`cs`）。技能名 = 词元（`.pi/skills/godot/`），代理名 = `词元-角色`（`godot-reviewer`、`godot-designer`）——技能与代理共用同一词元，禁用近义词干。
- 对照包内前缀族（`jero-*`/`review-*`/`sdd-*`/`jd-*`）与项目 `.pi/` 现有资产查重。
