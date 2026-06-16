# RFC 0006: 语音运行时

返回入口：[标准语音能力](0006-standard-voice-capability.md)

## 公开类型

在 `packages/types/src/voice.ts` 中增加共享类型：

```ts
export interface SpeechToTextServiceSummary {
  capabilities?: SpeechToTextCapabilities
  default: boolean
  enabled: boolean
  id: string
  label: string
  provider: string
}

export interface SpeechToTextResult {
  durationMs?: number
  language?: string
  segments?: SpeechToTextSegment[]
  serviceId: string
  text: string
  words?: SpeechToTextWord[]
}
```

服务商原始响应默认只保留在服务端；除非 debug 模式显式请求，才返回脱敏后的诊断 payload。

## 服务端 API

新增 voice routes：

```text
GET  /api/voice/speech-to-text/services
POST /api/voice/speech-to-text
POST /api/voice/speech-to-text/test
```

`GET /services` 返回已配置服务、启用状态、默认服务元信息和非密钥诊断信息。

`POST /speech-to-text` 接收 JSON body。客户端把 `MediaRecorder` 生成的 blob 转成 base64 交给服务端；服务端再根据 provider 配置向目标服务发起 multipart、binary 或 JSON 请求。

- `audioBase64`：必填，音频 base64；兼容别名 `audio`。
- `filename`：可选文件名。
- `mimeType`：可选 MIME type。
- `serviceId`：可选。不传时使用 `voice.speechToText.defaultServiceId`。
- `language`：可选语言覆盖。
- `prompt`：可选服务提示词。

响应示例：

```json
{
  "success": true,
  "data": {
    "result": {
      "serviceId": "openai",
      "text": "transcribed text",
      "language": "zh",
      "segments": [],
      "words": []
    }
  }
}
```

失败时返回稳定的 `VoiceErrorCode` 和可展示给用户的安全信息。不能返回密钥、完整 headers，也不能返回能识别本地路径的原始音频元数据。

## Provider 契约

服务端 provider adapter 实现：

```ts
export interface SpeechToTextProvider {
  transcribe(input: SpeechToTextProviderInput): Promise<SpeechToTextResult>
  validateConfig(config: unknown): SpeechToTextConfigDiagnostic[]
}
```

输入包含：

- 解析后的服务配置；
- 音频 buffer、MIME type、原始文件名；
- 请求语言和 prompt；
- timeout signal；
- 带脱敏 helper 的 logger。

provider adapter 必须把空转写结果标准化为 `NO_SPEECH_DETECTED`，不能当成普通服务失败。

## Custom HTTP 映射

`custom-http` 支持：

- `multipart` body，包含文件和静态/模板字段；
- `binary` body，适配接受原始音频的 API；
- 带 `audioBase64` 的 `json` body，适配要求内嵌音频内容的服务；
- text、language、segments、words 的响应路径映射。

模板变量：

- `{{language}}`
- `{{prompt}}`
- `{{mimeType}}`
- `{{filename}}`

环境变量插值只在服务端执行。缺失环境变量时返回 `MISSING_CREDENTIAL`。

## 音频处理

客户端使用当前浏览器最合适的 `MediaRecorder` MIME type 录音。服务端校验：

- 最大时长；
- 最大字节数；
- 所选 provider 支持的 MIME type；
- 请求超时。

如果 provider 不接受浏览器产出的 MIME type，第一版可以返回 `UNSUPPORTED_AUDIO_FORMAT`。音频转码能力后续可以在同一 provider 契约下补充。

## 错误码

必须支持的错误码：

- `NO_DEFAULT_SERVICE`
- `SERVICE_NOT_FOUND`
- `SERVICE_DISABLED`
- `MISSING_CREDENTIAL`
- `MICROPHONE_PERMISSION_DENIED`
- `RECORDING_UNSUPPORTED`
- `UNSUPPORTED_AUDIO_FORMAT`
- `AUDIO_TOO_LARGE`
- `PROVIDER_AUTH_FAILED`
- `PROVIDER_RATE_LIMITED`
- `PROVIDER_TIMEOUT`
- `PROVIDER_BAD_RESPONSE`
- `NO_SPEECH_DETECTED`
- `NETWORK_ERROR`
- `UNKNOWN`

客户端根据错误码映射到明确动作：配置、重试、选择其他服务、请求浏览器权限或丢弃。

## 隐私与日志

- 默认不持久化原始音频。
- 不在 info 级日志记录转写文本。
- 不记录模板展开后的请求 headers。
- 脱敏 `apiKey`、`apiKeyEnv` 解析值、`Authorization`、`x-api-key` 和自定义密钥 header 名。
- 配置测试调用应使用用户选择的音频或生成的样例，并明确说明留存行为。
