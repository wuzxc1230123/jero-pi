# 多人联机（Godot 4 高层 API）

基线：权威服务器模型（server 模拟、client 呈现）。先单机可玩再做联机——联机不是架构附加层，是架构决策。

## 连接面（ENet起步）

```gdscript
# net.gd —— autoload
extends Node

const PORT := 8910
const MAX_CLIENTS := 8

func host() -> void:
	var peer := ENetMultiplayerPeer.new()
	peer.create_server(PORT, MAX_CLIENTS)
	multiplayer.multiplayer_peer = peer
	multiplayer.peer_connected.connect(_on_peer)

func join(address: String) -> void:
	var peer := ENetMultiplayerPeer.new()
	peer.create_client(address, PORT)
	multiplayer.multiplayer_peer = peer
```

- `multiplayer.multiplayer_peer` 置换即切换模式；`multiplayer.is_server()` 判身份。
- Web 出口用 `WebSocketMultiplayerPeer`（ENet 不进浏览器）；NAT 穿透/中继是部署题（自建中继或 Steam Networking）——先局域网 + 直连，别一开始就上大厅服务。
- 断线三信号都要接：`peer_connected/peer_disconnected/connection_failed` + `multiplayer.connected_to_server`。

## authority（谁有权模拟）

```gdscript
func _ready() -> void:
	if is_multiplayer_authority():
		set_physics_process(true)     # 只有权威端跑模拟
	else:
		set_physics_process(false)
```

- `set_multiplayer_authority(id)` 在 spawn 时定（玩家实体 authority = 其 peer id）；默认 server 权威。
- **只有 authority 发 rpc**；非权威端发 = 协议违规。`is_multiplayer_authority()` 是每个网络脚本的第一行判断。

## rpc 纪律（@rpc 装饰器）

```gdscript
@rpc("any_peer", "call_local", "reliable")
func chat_message(sender: int, text: String) -> void: ...

@rpc("authority", "unreliable_ordered")
func sync_state(pos: Vector3, vel: Vector3) -> void: ...

# 调用面
rpc_id(target_peer, "chat_message", multiplayer.get_remote_sender_id(), msg)
```

- 三档配置各归其位：可靠有序（聊天/回合指令）/ 不可靠有序（高频状态同步）/ 不可靠（ Cosmetic 粒子触发）。
- rpc 名与方法名一致、参数必须可 Variant 序列化（Node/Resource 不行）；`get_remote_sender_id()` 鉴身份，**绝不信任客户端自报 id 之外的任何声明**。
- `call_local` 显式声明本地也执行（host 单机模式复用同一路径）；rpc 调用点集中在网络边界层，不散在玩法代码里。

## 状态同步（SceneMultiplayer 高层件）

- `MultiplayerSpawner`：server spawn 的场景自动复制到 client（敌人生成走它，手动 rpc 同步 spawn 是重复造轮子）。
- `MultiplayerSynchronizer`：勾选同步属性（`position` 等），`delta_interval` 降频（0.05–0.1s 起步）；**只同步权威端拥有的属性**。
- 玩家实体：client 本地预测输入（本地立即动）+ server 权威校正（`sync_state` 差值插值）——先做"server 权威 + client 插值呈现"，预测回滚是后期优化。

## 常见坑

- 多人改动单机逻辑：所有玩法入口先问"这是谁的 authority"——单机逻辑直接搬进联机 = 幽灵模拟（双端都跑物理）。
- scene tree 不同步：client 也要加载同场景（`change_scene` 各端各自执行）；专用服务器裁剪：`--server` 头less 跑（无渲染，见 `export-publishing.md`）。
- rpc 打点风暴：每帧全属性 reliable 同步（带宽炸）——`MultiplayerSynchronizer` 不可靠通道 + dirty 位。
- 玩家退出：`peer_disconnected` 里清理实体（queue_free 由 server 走 spawner 反向复制），直接不管 = 幽灵节点。
- 测试：`--headless` 起多进程（server + N client）跑通脚本（见 `testing.md` 多进程节）；CI 里两进程握手即冒烟。
