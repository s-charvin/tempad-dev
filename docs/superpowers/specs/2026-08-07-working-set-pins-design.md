# Working Set Pins — 选区记忆与 MCP 默认根

**状态：** Approved（待实现计划）  
**日期：** 2026-08-07  
**适用范围：** `packages/extension`（UI 选区状态、Pin 交互）、`packages/shared`（`get_code` 结果契约）、`packages/mcp-server`（说明/序列化若有依赖）、相关测试与 agent 说明  
**不适用范围：** 跨标签/跨设备同步、命名多组收藏、写回 `figma.currentPage.selection`、Deep select / Measure 行为变更

## 1. 摘要

当前扩展把 `figma.currentPage.selection` 1:1 镜像为面板/MCP 工作对象。画布点击会冲掉先前选中；Figma 文档重载后 `SceneNode` 引用失效且 `layoutReady` 清空状态。开发「一次需求涉及多个离散组件」时不可用。

本规格引入与画布选区解耦的 **Working Set**：

- `pins`：有序、去重的 nodeId 工作集（用户显式 Pin）
- `activeFocusId`：驱动 Code / Meta / `get_screenshot` 的单节点焦点
- `figmaSelection`：仅作「加入 Pin」的来源镜像，不再驱动 Code

同标签页用 `sessionStorage`（按 `fileKey`）持久化 pinIds 与焦点；恢复时用 `getNodeById` 解析并修剪失效节点。MCP 省略 `nodeId` 时优先使用 pins；多 pin 时对 `get_code` **串行**产出 batch 信封。

## 2. 问题陈述

### 2.1 根因

1. **语义耦合**：`packages/extension/ui/state.ts` 的 `selection` 与画布选区同步；`composables/selection.ts` 在 click / keydown / 窗口激活时直接覆盖。
2. **引用易失**：以 `SceneNode[]` 为 source of truth；文档刷新后引用过期；`layoutReady === false` 时直接 `selection = []`。
3. **无会话记忆**：偏好用 `localStorage`，但工作对象无按文件、按标签页的 ID 级记忆。

### 2.2 可观察症状

1. 点其他 layer → 先前选中丢失。
2. 长时间离开或 Figma 页重载 → 选中丢失，开发流程被打断。

### 2.3 成功标准

1. Pin ≥3 个节点后，画布任意点选不改变 `pins` / `activeFocusId`。
2. 同 tab 内刷新后：仍存在的节点恢复进 pins；已删除节点被修剪；焦点按回落规则恢复。
3. Code / Meta 仅跟随 `activeFocusId`；从 pin 列表切换焦点即可换代码。
4. MCP：`nodeId` 省略且有效 pins≥2 → `GetCodeBatchResult`；=1 → 现有 `GetCodeResult`；无 pin 时回退画布选区。
5. 关闭浏览器标签页 → Working Set 清空。

## 3. 目标与非目标

### 3.1 目标

| 目标                | 可观察结果                                   |
| ------------------- | -------------------------------------------- |
| 显式工作集          | 用户可跨 layer 累积 pin，不受画布点选冲掉    |
| 会话恢复            | 同 tab 刷新后仍可继续对 pin/焦点工作         |
| 单焦点出码（UI）    | Code 面板始终针对一个清晰焦点                |
| 多 pin Agent 工作流 | 省略 `nodeId` 时串行拿到多段 `get_code` 结果 |

### 3.2 非目标

- 跨标签、跨设备、长期 `localStorage` 收藏（用户明确选择 tab-only）
- 命名多组 Working Set
- Pin / 设焦点时强制写回 Figma 画布 selection（避免与 deep select / measure 冲突）
- 修改 Deep select / Measure 自身逻辑
- 一期不做自动「画布多选即 pin」

## 4. 状态模型

### 4.1 三层状态

| 状态                  | 含义             | 更新方                         | 消费方                       |
| --------------------- | ---------------- | ------------------------------ | ---------------------------- |
| `figmaSelection`      | 画布实时选区镜像 | 现有 DOM/快捷键 sync           | 仅 Pin 来源；不再驱动 Code   |
| `pins`（有序 nodeId） | 工作集           | Pin / Unpin / Clear / 恢复修剪 | 列表 UI；MCP 默认根          |
| `activeFocusId`       | UI/截图焦点      | 首 pin、点击 pin 行、修剪回落  | Code、Meta、`get_screenshot` |

**命名约定：** 避免继续用模糊的 `selection` 同时表示「画布选区」与「工作对象」。落地时：

- 新增明确命名的状态与派生（`figmaSelection` / `pinIds` / `activeFocusId` / `activeFocusNode` / `workingNodes`）
- 收敛旧 `selection` / `selectedNode` 读点；允许薄兼容层短期指向 `workingNodes` / `activeFocusNode`，但 source of truth 必须是 ID

### 4.2 持久化

```ts
// sessionStorage
key: `tempad-dev:working-set:${fileKey}`
value: {
  version: 1
  pinIds: string[]
  activeFocusId: string | null
}
```

- **只存 ID**，不存 `SceneNode`。
- `fileKey`：优先 `figma.fileKey`；若不可用则用稳定 fallback（例如从 `location.pathname` 解析的 file key）；仍不可用则用进程内记忆、**不写 storage**（避免错误串文件）。
- 切文件：读写对应 key，不串档。
- 关标签页：`sessionStorage` 自然清空。

### 4.3 解析与恢复

触发：`layoutReady` 变 true、窗口重新可见且 mode 为 standard、显式 Pin 操作后写回。

算法：

1. 读取 storage（若有）或采用内存中的 `pinIds`。
2. 对每个 id：`figma.getNodeById`；非 `SceneNode` 或不可用则剔除。
3. 若 `activeFocusId` 不在剩余 pins 中：回落到 `pins[0]`，否则 `null`。
4. 若发生修剪：写回 storage；UI 可轻量提示「N 个 pin 已失效并移除」（非打断式）。

**不要**把解析后的 `SceneNode` 当作跨刷新的 source of truth；每次需要节点对象时再 resolve。

### 4.4 容量

- Pin 上限：**50**。超出时拒绝新增并 toast/提示，不静默丢弃已有项。

## 5. UI 交互

### 5.1 主路径

1. 用户在画布/左侧图层面板选中节点 → 点 **Pin** → 将当前 `figmaSelection` 中可见节点追加进 `pinIds`（去重、保序）。
2. 若此前无 `activeFocusId`：设为本次新加入的第一个 id。
3. 之后画布点选只更新 `figmaSelection`，**不**改 `pins` / `activeFocusId`。
4. 点击 pin 行 → 设 `activeFocusId` → Code/Meta 更新；提供「滚动进视口」（对焦点节点）。
5. Unpin 单行 / Clear all；清空后 Code 为 No selection。

### 5.2 面板结构

- **Meta**：展示当前焦点名称、滚动按钮、dev resource links（现状能力迁到焦点）。
- **Pins**（Meta 下方或紧邻）：列表项含名称、焦点态、Unpin；空态文案引导「选中图层后 Pin」。
- 画布多选时：一次 Pin 可加入多个可见节点。

### 5.3 明确不做的交互

- 设焦点 / Pin 时不调用改写 `figma.currentPage.selection`。
- 不自动把画布选区同步进 pins。

## 6. MCP 契约

### 6.1 省略 `nodeId` 时的默认根

```
if (resolvedPins.length > 0) use resolvedPins
else if (figmaSelection 可见节点非空) use figmaSelection
else throw INVALID_SELECTION
```

提供 `nodeId` 时：行为与今日一致（单节点 resolve）。

### 6.2 `get_code`：单段兼容 + 多段 batch

| 根数量 | 行为                           | 结果                 |
| ------ | ------------------------------ | -------------------- |
| 1      | 现行单根管线                   | 现有 `GetCodeResult` |
| ≥2     | **串行**对每个根跑现行单根管线 | `GetCodeBatchResult` |

```ts
type GetCodeBatchResult = {
  batch: true
  items: Array<{
    nodeId: string
    name: string
    result?: GetCodeResult
    error?: { code: string; message: string }
  }>
}
```

判别：`batch === true` 为多段；否则为单段 `GetCodeResult`。

**约束：**

- **Per-item** 仍满足「恰好一个可见根」的管线不变量；requirements 文档改为「默认根来自 Working Set / 画布回退；多 pin 以 batch 交付」。
- 串行执行，避免并行导出/上传打爆资源。
- 单项失败写入 `item.error`，**继续**后续项；全部失败仍返回 batch（便于 Agent 看见清单），不把「部分失败」升格为整次工具失败。
- `buildGetCodeToolResult`（及 mcp-server 文本序列化）需能区分单段与 batch，给 Agent 可读摘要（例如 “Batch get_code: 3 items, 2 ok, 1 failed”）。

### 6.3 其他工具

| 工具             | 省略 `nodeId`                                        |
| ---------------- | ---------------------------------------------------- |
| `get_structure`  | 使用 resolved pins（或画布回退）；一次多根 outline   |
| `get_screenshot` | **仅** `activeFocusId`；无焦点则 `INVALID_SELECTION` |
| `get_token_defs` | 不变                                                 |

### 6.4 Agent / 说明文案

更新 extension/mcp-server instructions：省略 `nodeId` 时优先 TemPad Pins；多 pin 期望 `batch: true`；精确单节点应传 `nodeId`。

## 7. 架构落点（实现指引，非代码）

优先扩展既有模块，避免无必要新抽象层：

| 区域                       | 方向                                                                                              |
| -------------------------- | ------------------------------------------------------------------------------------------------- |
| `ui/state.ts`              | Working Set 状态、派生、sessionStorage 读写；收敛旧 `selection`                                   |
| `composables/selection.ts` | 仅同步 `figmaSelection`；增加恢复/激活时 rehydrate；**禁止**用画布选区覆盖 pins                   |
| Meta / 新 Pin 列表 UI      | Pin、Unpin、Clear、设焦点；复用现有 Section / IconButton 模式                                     |
| `mcp/runtime.ts`           | `resolveSelectionRoots` / `resolveSingleNode` 改为 Working Set 感知；`get_code` 多根走 batch 调度 |
| `packages/shared`          | `GetCodeBatchResult` 类型与序列化辅助                                                             |
| 测试                       | selection/working-set 单元测试；runtime batch 测试；更新依赖旧 `selection` 语义的测试             |

**不必新增** patch 类或平行「SelectionManager」巨型类；逻辑下沉到现有 composable + state 即可。若状态 helper 变厚，优先在 `ui/` 或 `composables/` 抽纯函数（可测），而不是新的框架式类层级。

## 8. 边界与错误

| 场景                  | 行为                                                           |
| --------------------- | -------------------------------------------------------------- |
| Pin 空选区            | 提示，无-op                                                    |
| Pin 不可见节点        | 跳过；若全部不可见则提示                                       |
| 超过 50               | 拒绝本次新增并提示                                             |
| 恢复时节点消失        | 修剪；焦点回落；可选轻提示                                     |
| `fileKey` 缺失        | 仅内存；不写 storage                                           |
| `layoutReady` false   | 不强制清空 pinIds（保留 ID）；节点派生为空；ready 后再 resolve |
| MCP 无 pin 无画布选区 | `INVALID_SELECTION`                                            |
| MCP 多 pin 中单项抛错 | 捕获为 `item.error`，继续                                      |

关于 `layoutReady` false：今日清空 `selection` 是丢记忆的直接推手。新设计在 ready=false 时 **保留 pinIds/activeFocusId**，只清空已解析的节点派生缓存。

## 9. 验证计划

1. **单元**：pin 去重保序、上限、焦点回落、storage round-trip、fileKey 隔离、layoutReady 不清 pinIds。
2. **单元**：`resolveSelectionRoots` 优先 pins、回退 figmaSelection；`get_code` 2+ pins → batch 形状；单项失败 partial success。
3. **单元/现有套件**：Code/Meta 读 `activeFocusNode`；旧 selection 测试迁移。
4. **手动**：Pin 多节点 → 点其他 layer → pins 仍在；同 tab 刷新 → 恢复；关 tab 重开 → 空；MCP 多 pin batch 抽检。
5. 仓库检查：`pnpm typecheck`、相关 package `lint`、`pnpm --filter @tempad-dev/extension test:node`（及必要 browser 测）。

## 10. 风险

| 风险                               | 缓解                                                                    |
| ---------------------------------- | ----------------------------------------------------------------------- |
| MCP 单/batch 双形状增加 Agent 分支 | instructions 写清；单 pin 保持旧形状降低破坏面                          |
| `sessionStorage` 被清理            | 接受 tab-only；行为仍优于今日                                           |
| 错误 `fileKey` 串档                | 严格 key；缺失则不持久化                                                |
| 旧代码仍读 `selection`             | 实现时全局收敛读点；测试锁语义                                          |
| Batch 总耗时/配额                  | 串行 + per-item 既有预算；上限 50 但实际 batch 可能较慢——可在摘要中提示 |

## 11. 决策摘要（已与产品确认）

- 模型：Pinned set + active focus（双层）
- 持久化：同标签页 `sessionStorage` only
- Code：跟焦点；Pin：记忆清单
- MCP：一期完整；多 pin **串行**多段 batch；部分失败保留 batch
- 省略 `nodeId`：优先 pins，否则回退画布选区
- 不写回 Figma selection
- 方案基线：Working Set 与画布解耦（方案 A）
