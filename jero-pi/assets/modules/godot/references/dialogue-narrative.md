# 对话与叙事系统

对话是数据问题，不是脚本问题：台词/选项/条件全部 Resource 化，运行时引擎只做"取数 + 呈现 + 记账"。

## 数据模型

```gdscript
class_name DialogueLine
extends Resource
@export var speaker_id: StringName
@export var text_key: String          # 本地化键，不存裸文案
@export var portrait: Texture2D
@export var next: StringName          # 下一节点 id；空 = 结束
@export var choices: Array[DialogueChoice] = []

class_name DialogueChoice
extends Resource
@export var text_key: String
@export var condition: StringName     # 黑板谓词名；空 = 恒可选
@export var effects: Array[StringName]  # 谓词/事件名
@export var next: StringName
```

- 图结构（节点 id → 节点）存一个 `DialogueGraph` Resource，一图一会话；`.tres` 可视化编辑由编辑器 Inspector 免费获得。
- 文案永远走键（`tr(text_key)` + CSV/PO 本地化），资源里不写死语言字符串。
- 效果（`effects`）只发事件总线命令语义事件（`quest_started`），对话引擎不直接改游戏状态。

## 运行时引擎（~80 行自持）

```gdscript
class_name DialogueRunner
extends CanvasLayer

signal line_shown(line: DialogueLine)
signal finished()

var graph: DialogueGraph
var blackboard: Dictionary[String, Variant] = {}   # 世界状态镜像（好感度/旗标；类型化 Dictionary 需 4.4+）

func start(graph_: DialogueGraph, bb: Dictionary) -> void:
	graph = graph_; blackboard = bb
	_show(graph.entry_id)

func _show(id: StringName) -> void:
	var line := graph.lines.get(id)
	if line == null: finished.emit(); return
	line_shown.emit(line)
	# 打字机 + 等待 advance 输入 → 选分支或 next
```

- advance 输入复用 `ui_accept`，打字机未完时第一次按 = 立即补全（跳过打字），第二次 = 下一句。
- 打字机用 `visible_characters` + `visible_ratio`（RichTextLabel），节奏 `@export`（每字 ms）+ 标点停顿表。
- 条件求值：黑板谓词注册表（`Dictionary[StringName, Callable]`），**不用** `Expression.eval` 裸评估字符串（注入面 + 不可测）。

## 选项与状态记账

- 黑板是**镜像**：真实状态住在游戏系统（任务/背包），黑板只在会话开始时快照 + 会话内试算，`finished` 后一次性提交效果事件。
- 选项一旦提交即不可回滚（对话树的不可逆性声明）；"重听"是显式回退节点，不是隐藏状态。
- 好感度/旗标变化当场给反馈（立绘切换/音效），叙事状态变化也是手感（见 `game-feel.md` 反馈层级 L0）。

## 视觉小说（VN）扩展

- 立绘/背景 = 资源状态机：`stage.set(speaker_id, emotion)`（`Sprite2D` 池 + 淡入淡出 tween），同一说话人换情绪不重播入场。
- 演出脚本（BGM 切换/震屏/立绘跳）进对话数据的 `cues` 数组，runner 广播 `cue_emitted` 事件，演出层订阅——数据与演出解耦。
- 历史/回放：`Array[DialogueLine]` 环形缓冲（上限 100 条），UI 只读。
- 自动播放/快进模式是 runner 的输入模式标志，与图数据无关。

## 测试（见 `testing.md`）

- 图完整性静态校验：所有 `next`/`choices[].next` 指向存在的节点（安装期/测试期跑，断链 = 死路对话）。
- 全路径可达性：从 entry 出发 BFS 断言无不可达节点。
- 条件谓词注册表与图内引用的谓词名对账（拼写错误显影）。
