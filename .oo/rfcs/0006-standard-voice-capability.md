# RFC 0006: 标准语音能力

返回入口：[RFC 索引](../../rfc.md)

## 背景

用户已经开始比较不同语音转文字服务，但 One Works 还没有一套标准的语音能力配置与消费入口。第一阶段的产品需求是聊天输入框语音转文字：用户录音，通过自己配置的服务转写，把结果插入到触发语音前的光标位置，并可选择转写完成后立即发送。

公开功能命名空间使用 `voice`。第一项能力是 `speechToText`；语音合成和实时语音 Agent 先预留，不在本 RFC 内实现。

## 目标

- 增加标准 `voice.speechToText` 配置段，支持默认服务和用户自定义 API 服务。
- API key 与服务密钥只在服务端解析；浏览器不能携带长期凭证直接请求第三方语音服务。
- 增加语音转文字配置页，包含一个“AI 辅助接入”入口，点击后创建新会话并填入提示词。
- 在 sender 左侧增加语音按钮，支持录音、计时、音频波形、停止转写、结果回填。
- 语音按钮右键菜单支持选择语音服务，并可直接进入语音转文字配置页。
- 将不同服务商返回结果标准化为统一前端契约：文本、语言、分段、词级时间戳、服务元信息和可恢复错误。

## 非目标

- 不在本 RFC 中实现完整实时语音 Agent。
- 不增加文本转语音播放能力。
- 不要求每个服务都支持流式识别、说话人分离、词级时间戳或语言自动识别。
- 默认不持久化原始音频或转写文本，除非后续审计/日志功能明确引入留存。
- 不把 project 配置文件视为明文密钥安全存放位置。project 配置应优先引用环境变量或未来的 secret ref。

## 用户故事

- 用户可以在配置文件里定义 OpenAI 兼容或自定义 HTTP 语音转文字服务，并设为默认服务。
- 用户不知道服务配置格式时，可以点击 AI 辅助接入按钮，进入一个已填好提示词的新会话，让 AI 引导创建配置。
- 没有配置服务时，点击 sender 语音按钮会展开配置提示，而不是静默失败。
- 配置多个服务时，右键语音按钮可以为当前录音选择服务，也可以打开语音配置页。
- 用户点击录音、说话、停止后，转写结果会插入到开始录音前的光标位置。
- 用户录音中点击发送动作时，One Works 会停止录音、完成转写、插入文本，然后自动提交消息。

## 高层架构

```text
配置文件
  -> packages/config schema and resolver
  -> apps/server services/voice
  -> /api/voice/speech-to-text
  -> apps/client api/voice
  -> Sender voice input
```

服务端负责服务解析、凭证解析、请求构造、响应解析和错误标准化。客户端负责麦克风采集、波形渲染、UI 状态、光标恢复和文本插入。

## 初始文件边界

- `packages/types/src/voice.ts`：共享配置、公开服务摘要、请求、结果和错误类型。
- `packages/config`：`voice` schema 与配置 section builder。
- `apps/server/src/services/voice/*`：服务注册、自定义 HTTP adapter、内置服务 adapter、凭证脱敏。
- `apps/server/src/routes/voice.ts`：服务列表、测试调用、转写接口。
- `apps/client/src/api/voice.ts`：类型化 HTTP 封装。
- `apps/client/src/components/config/*`：语音转文字配置 section。
- `apps/client/src/components/chat/sender/@components/voice-input/*`：sender 语音 UI。
- `apps/client/src/components/chat/sender/@hooks/use-sender-voice-input.ts`：录音/转写状态机。

## RFC 章节

- [配置与 AI 辅助接入](0006-standard-voice-configuration.md)
- [运行时 API 与服务契约](0006-standard-voice-runtime.md)
- [Sender 交互、落地计划与验证](0006-standard-voice-sender-plan.md)
