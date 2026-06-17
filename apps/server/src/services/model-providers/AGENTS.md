# Model Providers Service

本目录承载官方模型服务商能力的服务端业务逻辑。

适合放这里的任务：

- 服务商模型列表、余额、消费、状态和 secret 动作的上游 API client。
- provider action 的错误归一化、超时、缓存和 secret 脱敏。
- `modelServices` 指定 source 的模型刷新写回编排。

边界：

- 纯注册表、host 识别、图标和默认 base URL 解析放 `packages/utils/src/model-providers.ts`。
- HTTP 参数和状态码映射放 `apps/server/src/routes/model-providers.ts`。
- 不调用未公开的控制台接口，不从 iframe/webview 抓取 key、余额或状态。
