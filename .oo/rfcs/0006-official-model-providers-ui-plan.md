# RFC 0006：UI、分阶段落地与验证计划

返回 [RFC 0006](./0006-official-model-providers.md)。

## 配置 UI

更新 `ModelServicesRecordEditor`，支持两种模式：

- 服务商预设模式：选择官方服务商、区域/options、API key，以及可选管理 key。默认 base URL 和模型列表来自服务商注册表。
- 自定义模式：保留现有原始 `apiBaseUrl`、API key、models、timeout、max output 和 `extra`。

预期控件：

- 服务商选择器，展示 provider 图标和文字标签。
- 模型服务图标选择器；默认用 provider 图标，没有 provider 时提供常见服务商图标和固定默认图标。
- 千问区域选择器。
- Kimi 中国站/国际站显式选择器，不做自动切换。
- Base URL 预览和可编辑 override；默认保存不写 `apiBaseUrl`。
- 可选模型 allowlist 编辑器；默认保存不写 `models`。
- 管理主页预览和可编辑 override；默认保存不写 `homepageUrl`。
- secret 字段使用 password input。
- 操作按钮：测试连接、获取模型、刷新模型到配置、查询状态、查询余额/消费、创建或生成 secret、打开管理主页。

不支持的动作展示简短的服务商原因和控制台链接。

## 管理主页

模型服务详情页提供内嵌管理入口。Electron 使用 `webview`；浏览器模式使用 `iframe`。两者都只用于用户手动登录和管理后台，不读取页面内容，不抓取控制台接口。

如果平台通过 CSP、`frame-ancestors` 或 `X-Frame-Options` 禁止内嵌，UI 展示外部浏览器或新标签页 fallback。详细边界见 [管理主页与内嵌打开](./0006-official-model-providers-portal.md)。

## 服务状态

模型服务详情页展示服务商状态徽标和“打开状态页”链接。Statuspage JSON 和阿里云 Health Status OpenAPI 走服务端查询；只有状态页的平台只展示链接。详细规则见 [服务状态查询](./0006-official-model-providers-status.md)。

## 模型选择器

选择器格式不变。模型选择器继续输出 `service,model`。实现上需要把 `listServiceModels(mergedModelServices)` 扩展为支持官方服务商目录。

所有模型相关选择器都要展示图标：模型服务选择器展示 service/provider 图标；模型选择器展示 model 图标，缺省时回退到 service/provider 图标。聊天页、配置页和自动化启动页必须复用同一份解析后的 option 数据。

刷新成功后：

- 用户选择固定模型时，`modelServices.<key>.models` 写入选中的模型 ID。
- UI 继续按 service title 分组展示模型，并展示模型图标；模型没有图标时回退到 service/provider 图标。
- 已发现但未保存的模型只在配置页动作结果里展示，不进入聊天选择器。

手动模型 ID 必须持续有效。不能因为远端 list 没返回某个模型，就删除用户手动配置的条目。

## UX 文案

使用精确文案：

- Kimi 和 DeepSeek 使用“查询余额”。
- OpenAI 和 Anthropic admin cost report 使用“查看消费”。
- 阿里千问使用“生成临时 Key”。
- 没有公开 key 创建 API 的服务商使用“打开控制台创建 Key”。

One Works 的动作里避免表现成自有“充值”或“付款”。可以打开服务商购买、充值、套餐或账单页，但最终付款必须在服务商页面由用户亲自完成。

## CLI

服务端 route 稳定后增加 CLI helper：

```bash
oneworks config model-providers list
oneworks config model-services probe <service>
oneworks config model-services list-models <service>
oneworks config model-services refresh-models <service> --source user
oneworks config model-services balance <service>
```

CLI 输出需要区分已配置、已发现和不支持的能力。

## 分阶段落地

第一阶段：

- 服务商注册表和 schema enum。
- 服务商识别。
- 常见官方、云厂商、海外 relay、国内 relay 和自建网关模板的轻量 preset。
- 每个轻量 preset 至少提供图标、主页、API key、购买/充值、文档链接和“打开官网配置”按钮。
- OpenAI、Kimi 中国站、Kimi 国际站、DeepSeek、MiniMax 的服务端 `listModels`。
- 千问和智谱静态目录 fallback。
- 配置 UI 支持服务商预设创建。

第二阶段：

- Kimi、DeepSeek、OpenAI costs、Anthropic cost reports 的余额/消费动作。
- 模型刷新安全写回。
- 服务商 warning 和诊断 UI。

第三阶段：

- OpenAI admin key 和 service account secret 创建。
- 阿里临时 API key 生成。
- CLI wrapper。
- 可选的千问、智谱文档静态目录更新脚本。

## 验证

单元测试：

- 服务商 host 识别和冲突 warning。
- 每个服务商和区域的 endpoint 构造。
- 模型响应归一化。
- 余额/消费响应归一化。
- `modelServices` config source 写回时保留 sibling entry 和 masked secret。

服务端测试：

- `GET /api/model-providers` 不返回 secret 字段。
- `models/list` 不写配置。
- `models/refresh` 只写指定 source。
- 不支持的 provider action 返回结构化 unsupported 结果。
- 上游 401/429/5xx 映射为归一化错误，并且不泄漏 header。

客户端测试：

- 服务商预设表单填入默认 base URL。
- 服务商预设表单展示默认管理主页，默认保存不写 `homepageUrl`。
- 服务商、模型服务和模型 fallback 图标链路正确。
- 聊天页、配置页和自动化启动页的模型服务/模型选择器展示一致图标。
- 服务商状态徽标能展示正常、降级、故障、维护、未知和不支持。
- Kimi 中国站和国际站渲染不同 host。
- 千问区域/workspace 控件渲染正确 base URL 预览。
- Electron webview 和浏览器 iframe 被阻止时都有外部打开 fallback。
- 不支持的余额/secret 动作显示控制台链接，不显示可点击执行按钮。
- 手动模型在刷新结果选择后仍然保留。

手动 smoke：

- 配置 Kimi 中国站并查询模型/余额。
- 配置 Kimi 国际站，确认不会复用中国站 endpoint。
- 配置 DeepSeek 并查询模型/余额。
- 配置 MiniMax 并查询模型。
- 配置千问区域，并手动添加一个 Qwen 模型。
- 配置智谱 `https://open.bigmodel.cn/api/paas/v4`，并手动添加 `glm-*`。

## 迁移

现有服务继续工作，因为 `provider` 是可选字段，已有字段保持不变。

首次编辑时，UI 可以根据 host 推断推荐 provider。只有用户接受建议后，保存才写入 `provider`。

不做自动迁移，不跨 config source 重写 `modelServices`。
