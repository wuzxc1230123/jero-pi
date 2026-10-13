# 存档与持久化系统

存档是最容易写坏的系统：损坏、版本漂移、半写丢失。纪律 = 显式版本 + 原子写 + 校验和 + 迁移链。

## 路径与格式选型

| 路径 | 用途 |
|---|---|
| `user://save_{}.tres/json` | 玩家存档槽 |
| `user://settings.cfg` | ConfigFile：全局设置（与存档分离，删档不丢设置） |
| `res://` | 只读，禁写（导出包内只读） |

- JSON：跨版本最稳（缺键容错）、可 diff、易调试——**默认选它**。
- Resource（`ResourceSaver`）：类型安全但类定义漂移 = 读回失败风险，只用于与代码版本强绑定的单机快照。
- PCK/二进制：只在反作弊/体积关切时，先有 JSON 版本再迁移。

## 版本化与原子写

```gdscript
const SAVE_VERSION := 3

func write_slot(slot: int, data: Dictionary) -> bool:
	data["_version"] = SAVE_VERSION
	data["_checksum"] = _checksum(data)
	var path := "user://save_%d.json" % slot
	var tmp := path + ".tmp"
	var f := FileAccess.open(tmp, FileAccess.WRITE)
	if f == null: return false
	f.store_string(JSON.stringify(data, "\t"))
	f.close()                                   # close 后才 flush 完成
	DirAccess.open("user://").rename(tmp, path) # 原子替换：要么旧档要么新档
	return true
```

- 写入顺序铁律：序列化 → 写 `.tmp` → **close** → rename。断电/崩溃任一时刻磁盘上都有完整档。
- 校验和（内容哈希）挡"写了一半"与手改；损坏档的处理 = 隔离改名（`.corrupt`）+ 备份槽轮换，**绝不静默覆盖**。
- 槽位结构：`save_0..N` + `backup_0..N`（上次成功档），双份轮换写。

## 读档与迁移链

```gdscript
func load_slot(slot: int) -> Dictionary:
	var data := _read_and_verify(slot)
	if data.is_empty(): return {}
	match int(data.get("_version", 0)):
		1: data = _migrate_1_to_2(data); continue
		2: data = _migrate_2_to_3(data)
		3: pass
		_: push_warning("未来版本存档，拒绝读取"); return {}
	return data
```

- 迁移是**链式纯函数**（v1→v2→v3），每环有测试（旧档夹具 → 断言新形状，见 `testing.md`）。
- 读档防御：所有 `data.get(key, default)`，未知键保留（向前兼容），类型不符即丢弃该键并告警——绝不 `data["hp"]` 裸取。
- 未来版本（`_version` > 当前）拒读：降级打开新档是数据损坏源。

## 什么进存档（序列化面）

- **只存状态增量与不可推导值**：玩家位置/血量/物品/旗标/世界变更集（打开的门、挖掉的格子坐标集）。
- 系统状态可推导的不存（当前 BGM、UI 焦点）；引用场景资源用 `resource_path` 字符串，重载时 `load` 回。
- 生成世界存种子 + 变更集，不存全图（procgen 见 `procedural-gen.md`——同种子重放 + 变更集 apply）。
- 节点引用、Callable、Object **绝不** JSON 化（`var_to_str` 的循环引用炸弹）。

## 自动存档与时机

- 存档点（检查点/睡觉/进关卡）触发；`get_tree().paused` 状态下写档（世界冻结快照一致）。
- 自动存档节流：同类请求 2s 去抖；退出拦截（`NOTIFICATION_WM_CLOSE_REQUEST`）同步写一次。
- 存档期间禁止场景切换（写完发 `save_completed` 事件再切，总线见 `signals-groups.md`）。

## 云与多设备

- Steam Cloud：`user://` 落在云目录即自动同步；冲突解决策略声明（新 mtime 胜 + 本地备份保留）。
- 云档冲突按槽位合并是深坑——单设备游玩档不做合并，提示玩家二选一。

## 红线

- `FileAccess.open` 返回值不判空就用（磁盘满/权限即崩）。
- 无 `_version` 字段的存档格式（第一次改字段就全坏）。
- 写档在 `_process` 每帧做（I/O 卡帧）。
- 存档 Dictionary 里塞 Node（序列化即炸或写进垃圾指针）。
