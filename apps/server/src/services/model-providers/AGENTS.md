# Model Providers Service

本目录承载官方模型服务商能力的服务端业务逻辑。

适合放这里的任务：

- 服务商模型列表、余额、消费、状态和 secret 动作的上游 API client。
- provider action 的错误归一化、超时、缓存和 secret 脱敏。
- `modelServices` 指定 source 的模型刷新写回编排。
- adapter 原生模型服务的显式导入；通过可选 `model-provider-import` package capability 发现并调用 importer。adapter 只负责读取/转换原生配置，server 统一校验结果并在写锁内 additions-only 写入目标 source；不要在 server 重写各 adapter 的原生格式映射，也不要把客户端传入值直接当 package/path 加载。

边界：

- 纯注册表、host 识别、图标和默认 base URL 解析放 `packages/utils/src/model-providers.ts`。
- HTTP 参数和状态码映射放 `apps/server/src/routes/model-providers.ts`。
- 不调用未公开的控制台接口，不从 iframe/webview 抓取 key、余额或状态。

## Provider 能力接入经验

- 接新 provider action 时先区分数据语义：余额是货币或 credit 数值，额度是窗口化 quota，状态是可用性检查，模型列表是目录能力，令牌管理是平台管理能力。不要为了复用响应结构把不同语义混成一种结果。
- 上游没有稳定 `/models` 或模型列表不可代表套餐可用范围时，使用 registry 的默认模型并允许用户覆盖；不要假设所有 OpenAI-compatible endpoint 都能可靠列模型。
- 余额、额度、状态和远端令牌列表默认需要服务端缓存。缓存 key 应包含 provider、base URL、source、service/profile 标识和凭证指纹，避免不同配置互相污染；手动刷新不是主要交互，只作为排障或显式重试入口。
- 普通模型调用 key 与平台管理 token 必须分开处理。New API 这类平台管理接口可以读取余额、分组和令牌列表，但模型调用仍使用 profile 选中的远端令牌；不要默认用模型 key 调账户级接口。
- provider action 只能调用公开 API 或用户明确配置的管理 API，不从 provider portal iframe、浏览器 cookie 或非公开控制台请求里提取数据。
- 错误归一化要面向配置修复：区分缺少密钥、密钥类型错误、base URL 错误、无权限、上游不可用和响应格式不支持；前端不应靠字符串猜测失败原因。
