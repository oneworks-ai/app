# Voice 服务说明

`voice/` 承载服务端标准语音能力，目前入口是 speech-to-text。这里负责从合并后的配置中解析可用服务、默认服务和凭证模板，调用外部转写 provider，并把 provider 响应归一化成 `@oneworks/types` 的 `SpeechToTextResult`。

主要入口：

- `index.ts`：speech-to-text runtime，包括服务列表、音频载荷校验、OpenAI-compatible 转写、自定义 HTTP provider、错误码映射和 segments/words 时间戳归一化。
- `apps/server/src/routes/voice.ts`：HTTP API 路由，挂载在 `/api/voice`，包含服务列表、正式转写和配置测试接口。
- `apps/server/__tests__/routes/voice.spec.ts`：路由与 runtime 集成测试，覆盖默认服务、禁用/缺失服务、body limit、base64 校验、provider 字段映射和 API envelope。

涉及配置语义时同步检查 `packages/types/src/voice.ts`、`packages/core/src/config-schema.ts`、`packages/config/src/merge-voice.ts` 和 `packages/config/src/update.ts`。涉及前端消费时继续读 `apps/client/src/components/chat/AGENTS.md` 与 sender 子模块。
