# TemPad Dev 真实页面 1:1 实现增强规格

**状态：** Proposed  
**日期：** 2026-08-03  
**适用范围：** `packages/extension`、现有 agent skill、项目级视觉验证适配层  
**不适用范围：** 将 TemPad Dev 扩展为通用 Figma 读写 API

## 1. 摘要

TemPad Dev 的目标不是提供一个可遍历整份 Figma 文件的通用桥接层，而是向代码 Agent
提供可以直接用于真实应用实现的、可追溯的设计事实（design facts）。当前主证据链为：

1. `get_code`：输出结构、样式、token、asset 与代码生成上下文；
2. `get_structure`：仅在布局层级、几何或重叠不确定时补充结构证据；
3. `asset.url`：在 MCP 正文之外传递图像和 SVG 二进制；
4. shell / `depth-cap`：以父级组合事实为锚点，按需逐子树恢复，而不是截断大输出。

本规格增强这条既有证据链，使其能更可靠地支撑“Figma 设计 → 已有真实应用”的
1:1 实现。增强后的系统必须继续以结构化 Figma 事实为实现数值来源；截图只能验证
最终渲染结果，不能反向成为 CSS、token、布局或响应式行为的取数来源。

本文件的每个要求均按“做什么、为什么、怎么做”描述。这个三段式是**规格表达方式**，
不是发布阶段、开发顺序或必须拆分的 PR 数量。

## 2. 问题陈述

Figma Bridge 具备全量节点树、样式、变量、截图、动效和读写等能力，但其原始数据面
很大：一次全页读取可达数十 MB。将这类数据直接交给 Agent 会造成上游 MCP 客户端截断、
无关信息淹没、模型误解未选中节点，以及为了补全缺口而猜测样式的风险。

TemPad Dev 已明确采用反向策略：

- `get_code` 的 inline 响应预算为 64 KiB；
- 超预算时返回保留父级布局的 shell，而非任意字符串截断；
- 大型二进制通过 `asset.url` 旁路交付；
- `get_screenshot` 已存在于内部实现，但 `exposed: false`，不出现在常规 MCP 工具发现中；
- 变量身份来自 Figma Variables，不来自 Paint/Text/Effect Style 名；
- `get_structure` 不携带样式真相，且不得从截图推导数值。

因此，解决 1:1 问题的正确方向不是复制 Figma Bridge 的工具清单，而是：

1. 让 `get_code` 更完整、稳定地表达**当前节点真正使用的设计事实**；
2. 让已有的插件组件替换能力更可验证地映射到**真实应用中的组件边界**；
3. 用隔离于 MCP 主证据链的视觉回归确认最终画面，并把差异导回结构化证据重新判定。

## 3. 目标与成功标准

### 3.1 目标

| 目标                         | 可观察结果                                                                                          |
| ---------------------------- | --------------------------------------------------------------------------------------------------- |
| 提高视觉事实的代码表达完整度 | 已支持的 Figma 字段不因渲染管线遗漏而静默消失；输出保留精确、可渲染的值。                           |
| 保持 token 的可迁移性        | 已绑定的 Figma Variable 在颜色、文本、布局和效果等已支持属性族中使用同一 canonical token identity。 |
| 生成真实应用结构             | 已配置的 Figma 实例在 `get_code` 中可被稳定替换为项目组件输出，且不会重复渲染其后代。               |
| 发现最终渲染偏差             | 已有项目预览/截图能力时，可将 Figma 与应用截图比较，并输出可行动的差异摘要。                        |
| 控制上下文与安全边界         | 不增加大图/base64 内联、全页树、通用写入面或跨请求 Figma 派生缓存。                                 |

### 3.2 成功指标

指标在首个采用本规格的真实项目中采集；它们用于评估，不作为 MCP 输出字段。

| 指标             | 定义                                                                      | 达标条件                                         |
| ---------------- | ------------------------------------------------------------------------- | ------------------------------------------------ |
| 事实覆盖率       | `object-fit` 和 `text-decoration-color` 在测试夹具中的输出保留比例        | 100% 覆盖正常、变量绑定和降级场景                |
| 证据完整性       | shell / depth-cap 情况下能够通过父 shell + 指定子树重新获得完整组合的比例 | 所有预算测试夹具均可按提示恢复，不依赖截断字符串 |
| 组件替换正确率   | 有匹配 plugin 输出的 INSTANCE 中，使用插件结果且无后代重复输出的比例      | 100%                                             |
| 视觉回归可行动性 | 每个失败结果能定位到 viewport、阈值、差异区域及关联节点/测试用例          | 100%                                             |
| 上下文预算合规   | 常规 `get_code` 的最终 `CallToolResult` 大小                              | 不超过既有 64 KiB inline budget                  |

### 3.3 非目标

下列项目即使由 Figma Bridge 支持，也不属于本规格：

- 对外公开 `get_screenshot`，或把 PNG/JPG/PDF/base64 写入 MCP tool result；
- 增加 `get_document`、`get_selection`、`get_styles` 形式的全量原始 Figma 树或样式树；
- 创建、删除、修改、重排 Figma 节点，或提供通用 Figma 编辑 API；
- 用截图、OCR、视觉模型、`renderBounds` 差值反推布局坐标、颜色、字体或 token；
- 把 Figma Motion 编辑功能纳入本次范围；
- 扩展现有公开 MCP 工具的入参/输出 schema；
- 跨 `get_code` 请求持久化 Figma 派生缓存；
- 以新的独立组件注册表、artifact manifest 或 chunked `get_code` 协议替代 shell + 子树重取。

#### 3.3.1 明确不补全的 CSS 属性

以下属性虽在管线中可采集到，但经评估后**不做补全**，因为它们在真实 app UI 中
罕见、会随 asset 导出烘进产物、或补全后幻觉风险大于收益：

| 属性                                                          | 不做原因                                                                              |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `mask-image` / `isMask`                                       | 遮罩应随 asset 导出；CSS mask 浏览器兼容性差，AI 写出后大概率不生效                   |
| `transform` / 旋转分量                                        | 旋转元素几乎都是图标/装饰物，已走 SVG 导出；给 AI `rotate()` 会导致不该旋转的地方乱加 |
| `cornerSmoothing`（squircle）                                 | CSS 无可靠等价物（`corner-shape` 无浏览器支持）；加了只产生幻觉                       |
| `box-sizing`                                                  | Tailwind preflight 已全局设置；逐节点输出是冗余                                       |
| `text-decoration-style`（dashed/dotted）                      | app UI 中极罕见；error state 通常用颜色或 border                                      |
| `text-decoration-thickness`                                   | 极罕见；链接组件自行控制                                                              |
| `paragraphIndent`                                             | app UI 中几乎不存在                                                                   |
| Gradient text fill（渐变文字）                                | 极罕见；CSS `background-clip: text` 不稳定                                            |
| `openTypeFeatures`                                            | 极度小众；99% 的 app UI 不需要                                                        |
| `dashPattern` / `strokeCap` / `strokeJoin`                    | 矢量属性，已走 SVG 导出                                                               |
| `writing-mode` / `direction` / `unicode-bidi`                 | RTL 是 app 框架职责，非逐节点传递                                                     |
| `outline` / `will-change` / `contain` / `backface-visibility` | 性能/交互属性，非设计属性                                                             |
| 伪元素（`::before` / `::after`）                              | Figma 伪元素概念与 CSS 不同，强行映射幻觉风险高                                       |
| `transition` / `animation` / `@keyframes`                     | Figma 不产出；本规格保持 "base state only"                                            |

## 4. 不可违反的产品与架构原则

### R-01：设计事实优先

**做什么：** 将 `get_code` 输出、其 token/asset metadata 以及受限的 `get_structure`
视为设计事实；Agent 只能把这些事实重构为仓库既有约定，不能补造未出现的视觉值。

**为什么：** 1:1 的失败通常不是缺少一个 CSS 框架能力，而是把不存在的 hover、断点、
尺寸、字体 fallback 或阴影强行“补全”。原始 Figma 属性比截图像素更接近作者意图，
也比模型猜测更可复现。

**怎么做：**

- 新增代码路径只能消费当前选中节点及其必要后代的 Figma API 数据；
- 任何无法由节点、变量、资产或明确插件输出证实的状态均不得自动生成；
- `data-hint-*` 继续仅供 Agent 推理，最终应用代码必须移除；
- agent skill 保持“base state only”的约束；没有变体/交互/响应式证据时不生成它们。

### R-02：轻量、可恢复的 MCP 上下文

**做什么：** 保持 `get_code` 为小而完整的单次证据包；超预算时使用 shell 与窄范围
follow-up 恢复信息。

**为什么：** 上游 MCP 客户端可能在模型上下文限制之前就截断大结果。任意截断会破坏
父子关系、标签闭合和 token 证据，使 Agent 以不可信文本进行实现。

**怎么做：**

- 继续使用最终 `CallToolResult` 的 UTF-8 字节数作为预算依据；
- 保持 64 KiB inline budget 与 4 MiB transport cap；
- 保持 shell 内联“omitted direct children”顺序、`shell` warning 和 `data-hint-id` 的
  `depth-cap` 恢复语义；
- 新增视觉属性不得以额外大块 JSON 副本输出；它们必须进入现有 markup、tokens 或
  asset metadata 路径；
- 大图和 SVG 字节仅通过 `asset.url` 下载。

### R-03：MCP 与 UI codegen 分离

**做什么：** MCP 继续输出 Agent 取向的语义化 markup + Tailwind-compatible classes；
UI codegen 可有不同的 `WEB codeSyntax` 偏好，但不得成为 MCP 的隐式实现来源。

**为什么：** UI 代码导出偏向展示原始 Figma CSS，而 MCP 需要可被 Agent 分解、拼接、
token 化和适配仓库的稳定 IR。混用会使两个消费者的语义同时退化。

**怎么做：**

- 新增事实收集、样式规范化和渲染逻辑放在 `packages/extension/mcp/tools/code/**`；
- 仅当现有 `@tempad-dev/plugins` 的 DevComponent / component block 合约明确覆盖时，
  才经 `render/plugin.ts` 使用插件结果；
- 不从 `packages/extension/codegen/**` 复制或调用未经 MCP 语义验证的逻辑。

### R-04：截图只做后验验证

**做什么：** 将 Figma 截图与应用截图的比较定义为项目级视觉回归；它只报告“哪里不同”
和“差异是否通过”，不生成或修正设计数值。

**为什么：** PNG 结果包含设备像素比、字体可用性、浏览器抗锯齿、图片编码、动画时序等
渲染噪声。把这些像素直接转换为 `gap`、`font-size` 或 `left/top` 会制造伪事实。

**怎么做：**

- `get_screenshot` 保持 internal-only，沿用 `ensureAssetUploaded` 和 `asset.url`；
- 视觉比较由项目已有的 preview / Playwright / screenshot runner 执行；
- 失败报告只能包含阈值、viewport、掩码、差异比例、差异矩形和关联测试名；
- 修复者必须回到对应节点的 `get_code`（必要时 `get_structure`）确认事实后再修改应用；
- 视觉差异不能自动更改 Figma，也不能自动改变 TemPad 的生成规则。

## 5. 功能需求

### R-05：针对性样式事实补全

**做什么：** 仅补全当前管线中静默丢弃、且在真实 app UI 中高频出现的两个样式事实。
不追求覆盖所有 Figma CSS 属性；3.3.1 中已明确列出不做补全的属性及原因。

**补全项 1：Image fill 的 `object-fit` 映射**

当前 IMAGE fill 节点输出 `<img>` 时不携带 `object-fit`，导致图片裁切方式与 Figma
不一致。

改动：在 `collect.ts` 的 IMAGE fill 处理路径中，读取 `fill.scaleMode`，映射到
`object-fit`（`FILL` → `object-cover`，`FIT` → `object-contain`），并输出到
节点的 class 列表。

**补全项 2：`text-decoration-color` 补全**

当前 `text/style.ts` 的 `resolveRunAttrs` 只取 `text-decoration-line`，丢弃
`textDecorationColor`。真实 app 中链接下划线颜色经常和文字颜色不同（如蓝字黑下划线），
丢失会导致 1:1 不一致。

改动：在 `resolveRunAttrs` 中将 `textDecorationColor` 加入 run attrs，经现有
`decoration-` 前缀输出为 Tailwind class。

**为什么不补更多：**

经逐项评估（见 3.3.1），其余被丢弃的属性要么已随 asset 导出烘进产物（如 `dashPattern`、
`strokeCap`、旋转分量），要么在真实 app UI 中极罕见（如 `paragraphIndent`、
`openTypeFeatures`、渐变文字），要么补全后幻觉风险大于收益（如 `mask-image`、
`cornerSmoothing`、伪元素）。不为补全而补全。

**验收标准：**

- Image fill `scaleMode=FILL` 的节点输出包含 `object-cover`；
- Image fill `scaleMode=FIT` 的节点输出包含 `object-contain`；
- 无 `scaleMode` 或非 IMAGE fill 的节点行为不变；
- 文本分段中 `textDecorationColor` 不为空时输出 `decoration-[color]`；
- `textDecorationColor` 为空时行为与当前完全一致；
- 两项补全均有纯函数单元测试与至少一个 `handleGetCode` 集成夹具；
- 输出仍通过 `assertToolResponseWithinBudget`。

### R-06：变量覆盖扩展到布局与效果属性

**做什么：** 将 canonical token IR 从当前主要的 paint/text 场景，扩展到已经能够安全
表达的 layout 与 effect 属性，例如 width/height、min/max size、padding、gap、inset、
border radius、stroke width、opacity、blur 和 shadow 参数。

**为什么：** 同一个 Figma Variable 可能绑定在背景色、圆角、间距和效果上。若颜色保留为
`var(--token)` 而圆角被固化为数字，应用无法统一映射主题、密度和 mode；相同变量也会在
不同属性族中失去身份一致性。

**怎么做：**

1. 保持 `GetCodeResult.tokens` 的既有单层 map 结构、`kind` 与
   `${collection}:${mode}` 键格式不变；
2. 以 Variable 的稳定 identity 生成 canonical CSS custom property 名，绝不能用
   Paint/Text/Effect Style 名作为 token identity；
3. 在样式收集完成、渲染前，向 `variables.ts` / `tokens/process.ts` 提供新增属性桶；
   同一 `(nodeId, property)` 可以含多个 `var()`，必须按出现顺序替换；
4. `resolveTokens: false` 时输出 canonical `var(--...)` 与相应 tokens payload；
   `resolveTokens: true` 时按当前节点的 variable mode override 解析成 literal，并重新渲染
   受影响 style，确保 markup、tokens 与 themeable SVG root presentation color 一致；
5. 默认保留 fallback 去除规则：fallback 不得成为 token value 的事实来源；
6. variable 无法安全映射为一个 CSS 值（例如多槽复合 effect）时，保留当前具体输出值，
   在开发日志写入不可映射的 property 与原因；不伪造多个新 token；
7. 不新增公开 `get_token_defs` 参数或 `get_code` 返回字段。本规格只扩展已存在 code 与
   tokens 语义所覆盖的属性族。

**验收标准：**

- 相同 variable 绑定在 color、gap、radius 三处时，三处引用同一 canonical token；
- alias chain 与多 mode token 仍完整存在于 payload；
- `resolveTokens=true` 可正确解析每个节点的 mode，且不残留过时 `var()`；
- style 名与 variable 名相同或相似时，仍只输出 Variable token；
- 没有 variable 绑定的属性输出与当前行为完全一致。

### R-07：实例到真实应用组件的受控映射

**做什么：** 在已配置 TemPad plugin 的前提下，建立针对 INSTANCE 的组件映射验收规则，
并补足插件输出的结构、token、asset 与 shell 交互测试。映射的产物仍是现有
`DevComponent` 或 `component` code block，不新增一个绕开插件 sandbox 的组件注册表。

**为什么：** 真实应用通常已有 Button、Avatar、ListItem、Card 等组件。重复展开 Figma
内部层会同时降低代码可维护性和视觉一致性；相反，未经验证的组件替换也可能漏掉实例级
尺寸、颜色或 variant 差异。

**怎么做：**

1. 继续在 `handleGetCode()` 中收集 visible tree 内的 INSTANCE，调用
   `resolvePluginComponents()` 批量解析，维持现有最多一次/实例/请求的约束；
2. plugin 返回 component/code 后，继续通过 `skipDescendants()` 排除该实例后代的样式、
   文本、向量资产和渲染，防止重复输出；
3. 要求插件输出自行承担组件内部结构，而 `get_code` 保留实例所在父容器的布局事实；
4. 为实例级、且不属于组件内部 API 的外层事实保留 wrapper 或现有 presentation props；
   不将未知 Figma property 自动猜测为组件 prop；
5. plugin 没有匹配、返回空结果、超时或被 sandbox 拒绝时，必须退回标准 Figma 渲染路径，
   并不得跳过后代；
6. `preferredLang` 仍仅是偏好；由 `lang` 作为最终返回语言。JSX/Vue 选择必须在
   plugin component block 与 renderer 之间一致；
7. shell 路径不执行完整 plugin 收集的现有策略继续有效。shell 是组合恢复机制，不能为了
   获取插件结果突破 inline budget。

**验收标准：**

- 有 plugin 匹配的实例仅出现一次，且其后代的 `data-hint-id`、asset 和文本均不重复出现；
- plugin miss 时，实例和全部后代按普通 renderer 输出；
- 多实例请求保持一次批量解析调用，不逐实例发起 sandbox 请求；
- 组件输出在 JSX 与 Vue 的语言选择下均可被 stringify，且不破坏父容器顺序；
- shell、depth-cap 和 plugin-enabled 场景均维持原有预算与可恢复语义。

### R-08：项目级视觉回归适配

**做什么：** 定义一个可选的项目侧视觉回归契约，用于比较“同一范围”的 Figma screenshot
与应用 screenshot。TemPad 核心 MCP 不公开新截图工具，也不把任何图像字节放进 tool
result；项目可根据自身已有测试基础设施实现适配器。

**为什么：** 结构化事实能避免猜测，但最终页面仍可能受应用 reset、字体载入、组件默认值、
渲染器差异和资产处理影响。视觉对比是确认渲染结果的有效手段，但必须与事实提取隔离。

**怎么做：**

1. Figma 侧只调用内部 `handleGetScreenshot()`；它用 `exportAsync({ format: 'PNG' })` 导出，
   按 `1 → 0.75 → 0.5 → 0.25` 逐级缩放，并通过 `ensureAssetUploaded()` 获得 `asset.url`；
2. 项目侧截图 runner 使用确定的浏览器版本、viewport、device scale factor、色彩模式、
   时区、locale、网络 mock 与字体安装；禁用动画或固定动画到已定义时间点；
3. 比较输入必须记录 `figmaNodeId`、Figma 导出 `width`/`height`/`scale`、应用 route 或
   story id、viewport、浏览器及比较阈值；
4. 对比器可以产生 pixel diff、感知 diff 或区域 diff，但其输出只能是：
   `passed`、差异比例、阈值、差异矩形列表、遮罩矩形列表、工件 URL/本地路径和人类可读摘要；
5. mask 只允许覆盖双方都不可控且已文档化的区域，例如动态时间、随机头像、远端广告或
   操作系统字体 fallback。mask 不能覆盖核心布局、文字、图标或设计资产；
6. 当测试失败，报告必须给出关联的 Figma node id 与应用测试 id。修复流程为：
   先读取 `get_code`，仅在层级/重叠有歧义时读取 `get_structure`，然后修改应用；
7. 视觉对比不得回写 Figma，不得自动提交应用修改，不得把截图交给模型以推导数值；
8. 当目标仓库没有可执行的 preview/screenshot 流程时，标记结果为 `unverified`，要求用户
   在 Figma 中人工验证，而不是假设视觉通过。

**验收标准：**

- 同一固定输入连续运行两次不会产生未解释的差异；
- 人为修改 1px border、文字行高、图标颜色、mask 外的布局时，比较均能失败并定位差异区域；
- 仅修改被批准 mask 覆盖的动态区域时，比较不失败；
- 报告不含 base64 图片内容，也不将大图写进 MCP `content.text`；
- 视觉失败后可从报告中的 node id 获取可用的 `get_code` 证据。

### R-09：证据恢复与失败处理

**做什么：** 为所有新增事实、token 与组件替换明确 shell、depth-cap、资产失败和视觉失败
情况下的处理规则。

**为什么：** 高保真能力若只在小节点上正确，会在真实页面最复杂、最需要恢复的地方失效。
失败路径必须与正常路径同样可预测。

**怎么做：**

| 场景               | 必须行为                                                | 禁止行为                                              |
| ------------------ | ------------------------------------------------------- | ----------------------------------------------------- |
| `depth-cap`        | 返回已有父级证据；Agent 用 `data-hint-id` 获取所需子树  | 重新请求相同范围并期待不同结果；猜测未返回后代        |
| inline budget 超限 | 返回父 wrapper + 有序 omitted direct child ids 的 shell | 任意字符串截断；扩大预算给公开 MCP 调用               |
| SVG upload 失败    | 保留符合现有规则的 inline SVG fallback                  | 删除向量结构；以随机图标替代                          |
| plugin miss/失败   | 回退至普通 Figma renderer                               | 跳过实例后代；捏造组件名称或 props                    |
| 变量无法安全表达   | 保留已收集的具体 CSS 值并记录开发日志                   | 将 style 名伪造为 token；把多值 effect 拆成猜测 token |
| screenshot 过大    | 继续按既有缩放阶梯尝试；仍超限则失败并提示缩小范围      | 内联大 base64；降低图片精度后仍假称 1:1 验证          |
| 视觉回归失败       | 输出差异摘要，回到结构化证据复核                        | 用像素差自动改 CSS 数字或回写 Figma                   |

## 6. 技术设计

### 6.1 端到端数据流

```text
Figma SceneNode
  │
  ├─ buildVisibleTree / request-scoped cache
  │
  ├─ collectNodeData
  │    ├─ getCSSAsync（每节点最多一次）
  │    ├─ styled text segments（含 textDecorationColor）
  │    ├─ image fill scaleMode → object-fit
  │    └─ raw variable candidates
  │
  ├─ prepareStyles
  │    ├─ layout / inferred-layout rules
  │    └─ variable property buckets（扩展到 layout/effect）
  │
  ├─ planAssets / exportVectorAssets
  │
  ├─ resolvePluginComponents（仅 INSTANCE，批量）
  │
  ├─ renderTree / renderShellTree
  │
  ├─ processTokens / resolveTokens rerender
  │
  └─ buildCodeResult
       ├─ markup
       ├─ tokens
       ├─ asset URL metadata
       └─ warnings

项目应用实现
  │
  └─ 可选视觉回归 runner
       ├─ Figma internal screenshot asset URL
       ├─ deterministic app screenshot
       └─ structured diff report（不回流为设计数值）
```

### 6.2 代码所有权与候选改动位置

| 责任                  | 主要文件                                                                                              | 变更性质                                                                  |
| --------------------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Image fill object-fit | `packages/extension/mcp/tools/code/collect.ts`                                                        | 读取 `fill.scaleMode` 映射到 `object-fit` class                           |
| text-decoration-color | `packages/extension/mcp/tools/code/text/style.ts`                                                     | `resolveRunAttrs` 中补全 `textDecorationColor`                            |
| 变量绑定与重写        | `packages/extension/mcp/tools/code/{variables.ts,tokens/**}`                                          | 将新属性桶接入 canonical token 流程                                       |
| 组件替换              | `packages/extension/mcp/tools/code/render/plugin.ts`、`index.ts`                                      | 加固批量、fallback 与后代跳过行为                                         |
| 截图内部交付          | `packages/extension/mcp/tools/screenshot.ts`                                                          | 仅保持/完善 URL-first 内部导出，不公开                                    |
| 共享 contract         | `packages/shared/src/mcp/tools.ts`                                                                    | 本规格默认不改；如后续发现破坏性必要性，必须另立 contract proposal        |
| Hub 工具公开面        | `packages/mcp-server/src/tools.ts`                                                                    | 保持 `get_screenshot`、`get_token_defs`、`get_assets` 的 `exposed: false` |
| Agent 使用规范        | `agent-plugins/tempad-dev/skills/figma-design-to-code/SKILL.md`                                       | 澄清新增事实、组件映射和视觉验证工作流                                    |
| 测试                  | `packages/extension/tests/mcp/tools/code/**`、`packages/extension/tests/mcp/tools/screenshot.test.ts` | 补齐纯函数、pipeline、预算与回归测试                                      |

### 6.3 兼容性

- `get_code` 现有入参保持不变：`nodeId`、`preferredLang`、`resolveTokens`、`vectorMode`；
- `GetCodeResult` 现有字段的含义保持不变；新增事实优先通过已有 `code` 和 `tokens` 表达；
- `warnings.type` 继续只使用 `auto-layout`、`shell`、`depth-cap`；
- `get_structure` 不新增样式字段，也不成为截图替代品；
- asset descriptor 的 URL、hash、mime type 与 `themeable` 语义不变；
- `get_screenshot` 继续不被 Hub 的正常 tool discovery 公开；
- 无 active plugin、无变量、无视觉回归 runner 的用户继续获得与当前等价的行为。

### 6.4 性能与资源限制

- `getCSSAsync()` 每节点最多调用一次；
- 所有缓存限制为单请求 `createGetCodeCacheContext()` 生命周期；
- 不为提升视觉覆盖而进行重复 vector export；
- vector export 并行度继续受现有上限控制，输出顺序必须由源树顺序决定；
- 视觉回归工件由项目测试基础设施管理，不进入 MCP 通信载荷；
- 每个新增属性族在大树夹具上验证不会改变 shell 触发语义，也不会绕过 early shell preflight。

## 7. 测试与验收策略

### 7.1 单元测试

为每个新增样式/变量 helper 建立 deterministic fixture。每个 fixture 至少覆盖：

- 字面量值；
- 绑定 Variable 的值；
- multi-mode/alias；
- 组合属性的稳定排序；
- 0、负数、极小数和 px/rem 精确值；
- Figma 不可见 paint/effect；
- 缺失字段、非法值或 Figma API 读取失败的降级行为。

测试不得依赖 jsdom；浏览器相关场景使用既有 Playwright browser 配置。

### 7.2 管线集成测试

在 `packages/extension/tests/mcp/tools/code/index.test.ts` 或按职责拆分的相邻测试文件中验证：

1. 完整树：新增事实进入最终 `code`，并保留准确 token metadata；
2. `resolveTokens=false`：canonical `var(--...)` 与 tokens payload 一致；
3. `resolveTokens=true`：mode-aware literal、SVG presentation style 与输出一致；
4. plugin hit：实例替换成功，后代不被再次收集/渲染；
5. plugin miss：普通 renderer 恢复全部后代；
6. shell：父级新样式仍保留，直接子节点按注释顺序可 follow-up；
7. depth-cap：不完整子树可通过 `data-hint-id` 恢复；
8. vector upload failure：inline SVG fallback 不丢失尺寸与颜色语义；
9. 多根选择：不同根的事实、shell 和 token 不串扰。

### 7.3 截图与视觉回归测试

核心 extension 仅测试 `handleGetScreenshot()`：

- 优先使用 1x；
- 超限时按既有 scale 阶梯回退；
- 全部超限时明确失败；
- `ensureAssetUploaded()` 接收准确的 bytes、mime type、宽高。

项目级视觉 runner 的 contract test 至少验证：

- 固定环境下相同页面对比可重复通过；
- 1px 描边、line-height、颜色和非 mask 布局改动导致失败；
- mask 仅覆盖声明区域；
- 报告包含 node id、应用测试 id、阈值和差异矩形；
- 报告不包含 base64 数据。

### 7.4 运行命令

实现变更按影响范围执行：

```bash
pnpm --filter @tempad-dev/extension test:node
pnpm typecheck
pnpm lint
pnpm test:run
```

如变更涉及 extension 打包或真实 Figma 运行时，再执行：

```bash
pnpm build:ext
pnpm --filter @tempad-dev/extension test:browser
```

如未来确有经过批准的 shared schema 修改，验证顺序必须为：

```text
packages/shared → packages/mcp-server → packages/extension
```

## 8. 发布、观测与回滚

### 8.1 发布原则

- 每个增强保持向后兼容，并通过现有 fallback 保护；
- 不把新的核心语义与 UI codegen 绑定发布；
- plugin 映射只对已启用 plugin 的用户生效；
- 视觉回归适配是 opt-in 项目能力，不成为 TemPad MCP 可用性的前提。

### 8.2 观测

沿用 `get_code` 的 debug timing 与 request-scoped cache metrics，并新增或扩展仅开发日志中的
汇总计数：

- `object-fit` 映射命中 / 未命中数量；
- `text-decoration-color` 补全命中 / 未命中数量；
- layout/effect Variable 成功 canonicalize / 因复合值跳过数量；
- plugin hit / miss / fallback / descendants-skipped 数量；
- shell、depth-cap、asset upload fallback 数量。

日志中不得写入完整截图、二进制、完整 token 值或用户设计文本。

### 8.3 回滚条件与方式

出现下列任一情况时，关闭对应新增事实 helper 或 plugin mapping 规则，并恢复上一稳定输出：

- 公开工具响应频繁超出 inline budget，且 shell 无法恢复；
- 新样式属性改变已有无变量节点的输出；
- `resolveTokens=true` 与 `false` 产生互相矛盾的 SVG/markup 表示；
- plugin 命中导致实例后代丢失、重复或布局父级损坏；
- 视觉回归在固定环境中有无法解释的非确定性。

回滚仅针对相关内部渲染/映射路径；不得通过提高公开 payload 上限、公开 screenshot 工具或
放宽“从截图取数”限制来规避问题。

## 9. 需要评审确认的边界

本规格已作出如下明确决定，实施前不需要再将其当作开放问题：

1. 优先补强 `get_code` 的事实覆盖，而不是引入全量原始 Figma 读取 API；
2. R-05 仅补全 `object-fit` 和 `text-decoration-color` 两项；3.3.1 中列出的属性不做补全；
3. token 扩展（R-06）仅覆盖可安全映射到单个 CSS 值的 layout/effect 属性；
4. 组件映射复用现有 plugin sandbox / DevComponent 路径，不新增绕开 sandbox 的注册系统；
5. 截图只在项目级视觉回归中使用，且图像字节不进入常规 MCP 上下文；
6. 不修改现有公开 MCP schema；若未来确有必要，必须独立提出跨 `shared`、
   `mcp-server`、`extension` 的 contract proposal；
7. 视觉回归失败是“需要结构化复核”的信号，而不是自动调参或自动修图命令。

## 10. 可追溯来源

- `docs/extension/mcp-get-code-requirements.md`
- `docs/extension/mcp-get-code-design.md`
- `docs/extension/mcp-context-strategy.md`
- `docs/extension/mcp-browser-gateway-design.md`
- `packages/extension/mcp/tools/code/index.ts`
- `packages/extension/mcp/tools/screenshot.ts`
- `packages/shared/src/mcp/tools.ts`
- `packages/mcp-server/src/tools.ts`
- `agent-plugins/tempad-dev/skills/figma-design-to-code/SKILL.md`
- `/Users/zuiyou/develop/skills/tempad-dev-output/00_对照表.md`
