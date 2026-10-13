# 多线程（Threading / WorkerThreadPool）

先回答"要不要"：多线程解决的是**重计算卡帧**（大世界生成、寻路批算、
图像处理、音频分析），不是"看起来更并发"。一帧内能分帧拆掉的计算
（`performance.md` 的分帧/节流）优先分帧——线程是最后手段，不是默认项。

## 选型阶梯（从轻到重）

| 手段 | 适用 | 代价 |
| --- | --- | --- |
| 分帧（每帧做一小块） | 可拆分的迭代计算 | 延迟摊到多帧 |
| `await` 协程 | 等待 IO/信号，不占 CPU | **不是线程**——仍在主线程 |
| `WorkerThreadPool` | 一次性任务/批量任务组（4.x 首选） | 任务内不能碰场景树 |
| `Thread` 节点级自管 | 长驻工作者/需要精细控制 | 手管 start/join/生命周期 |

## WorkerThreadPool（默认起点）

```gdscript
func _generate_chunk_async(chunk_id: int) -> void:
	WorkerThreadPool.add_task(func (): 
		var data := _generate(chunk_id)          # 纯计算：不碰节点/场景树
		_result_ready.emit(chunk_id, data)        # 结果经信号/Callable 回主线程消费
	)
```

- `add_task(callable)` 单任务；`add_group_task(callable, count)` 批量同构
  任务（一群瓦片各算各的）——比手搓 N 个 `Thread` 省 thread 生命周期开销。
- 任务内**纯计算 + 自带数据**：输入用捕获/参数传值拷贝进去，输出经
  信号或 `call_deferred` 回主线程——这是唯一的回家路。

## Thread（自管时）

```gdscript
var _thread: Thread
func _start() -> void:
	_thread = Thread.new()
	_thread.start(_worker, _payload)            # 传值进去
func _worker(payload: Dictionary) -> Dictionary:
	return _heavy(payload)                       # 同样：不碰场景树
func _stop() -> void:
	if _thread and _thread.is_started():
		_result = _thread.wait_to_finish()        # join；拿返回值
		_thread = null
```

- `wait_to_finish()` 必须在节点释放前调（`_exit_tree` 收尾）——未 join 的
  Thread 在退出时是崩溃/未定义行为。
- 共享可变状态（`Dictionary`/`Array`/字段）跨线程读写**必须** `Mutex`
  包住；能靠"传值进出"设计避免共享就别上锁。

## 引擎线程边界（背下来）

- **场景树/节点/资源只在主线程动**：子线程改节点属性、加删子节点、
  `get_node` 都是未定义行为。要回主线程：`call_deferred()` 或信号。
- `RenderingServer`/`PhysicsServer` 的部分 API 设计为可离主线程提交
  （查当前版本文档确认具体方法），但状态对象本身仍要管好所有权。
- `await` 是协程不是线程：`await get_tree().process_frame` 期间主线程
  照常跑——它解决"等"，不解决"算"。
- 主线程等子线程（忙等/轮询 `is_finished`）= 白开线程：要么让它回家
  （信号/deferred），要么本来就不该开。

## 可测性

- 重计算入口写成纯函数（数据进数据出），线程只是包装——单元测试直接
  调纯函数（`testing.md`），不测线程本身。
- 竞态复现难：共享面越小越好，锁粒度大到"一次交接一份数据"最稳。

## NEVER

- **NEVER 子线程碰场景树**（加删节点/改属性/get_node）——回家只有
  `call_deferred`/信号两条路。
- **NEVER 无 Mutex 跨线程读写共享容器**——读着写着崩给你看，且崩得
  随机不可复现。
- **NEVER 每帧 new Thread 不 join**：thread 泄漏 + 退出崩溃；任务型用
  WorkerThreadPool，长驻型单 Thread 管好 `wait_to_finish`。
- **NEVER 把 `await` 当并发**：协程全在主线程，重计算照样卡帧。
