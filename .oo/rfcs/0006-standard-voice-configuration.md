# RFC 0006: 语音配置

返回入口：[标准语音能力](0006-standard-voice-capability.md)

## 配置结构

新增根级 `voice` 配置段：

```json
{
  "voice": {
    "speechToText": {
      "defaultServiceId": "openai",
      "services": {
        "openai": {
          "label": "OpenAI",
          "provider": "openai-transcriptions",
          "enabled": true,
          "baseUrl": "https://api.openai.com/v1",
          "apiKeyEnv": "OPENAI_API_KEY",
          "model": "gpt-4o-mini-transcribe",
          "language": "auto",
          "timeoutMs": 60000,
          "maxDurationSeconds": 300
        },
        "company-asr": {
          "label": "Company ASR",
          "provider": "custom-http",
          "enabled": true,
          "request": {
            "method": "POST",
            "url": "https://asr.example.com/v1/transcribe",
            "headers": {
              "Authorization": "Bearer ${env:COMPANY_ASR_TOKEN}"
            },
            "body": {
              "kind": "multipart",
              "fileField": "file",
              "fields": {
                "model": "general",
                "language": "{{language}}"
              }
            }
          },
          "response": {
            "textPath": "data.text",
            "languagePath": "data.language",
            "segmentsPath": "data.segments"
          }
        }
      }
    }
  }
}
```

`services` 是以稳定服务 id 为 key 的 map。服务 id 用于默认服务、sender 右键菜单、遥测标签和 API 请求。展示名称使用 `label`。

## Source 语义

`voice` 遵循现有配置 source 模型：

```text
global < project < user
```

运行时读取 `mergedConfig.voice`。配置页编辑时必须只读写用户选择的 source 的 raw `voice` section，不能从 merged config 反推并重建 source 文件。

推荐放置：

- `global`：个人默认服务、私有 endpoint 偏好、非项目级默认值。
- `project`：团队共享服务定义，引用环境变量，不能写入明文密钥。
- `user`：当前 workspace 的本地覆盖，包括默认服务 id 和本地环境变量名。

明文密钥只允许在 `global` 或 `user` UI 表单中经过明确警告后保存，API 响应必须脱敏。project 配置 UI 应引导用户使用 `apiKeyEnv`、`${env:NAME}` 或未来的 secret store ref。

## Provider 类型

第一阶段 provider 类型：

- `openai-transcriptions`：向 `<baseUrl>/audio/transcriptions` 发起 multipart 请求，携带文件、model、language、prompt 和 response format。
- `custom-http`：用户自定义请求和响应映射，适配任何接受文件上传或音频 URL 的服务。

预留 provider 类型：

- `deepgram-listen`
- `assemblyai-transcript`
- `google-speech`
- `azure-speech`
- `aws-transcribe`
- `local-command`
- `plugin`

预留类型后续可以在不改变 sender 契约的前提下继续实现。

## 配置页

在现有 config route 下增加语音转文字 section，可通过以下地址进入：

```text
/config?section=voice.speechToText
```

该 section 包含：

- 复用现有配置页语义的 source switch；
- 默认服务选择器；
- 服务列表，展示启用/禁用状态与当前生效默认标记；
- `openai-transcriptions` 和 `custom-http` 的创建/编辑表单；
- 脱敏后的密钥展示；
- 测试转写动作，可使用极小本地样例或用户选择的文件；
- “AI 辅助接入”按钮。

## AI 辅助接入按钮

点击后创建或打开一个新的聊天会话，并把提示词填入 composer。该动作不自动发送。

提示词模板：

```text
我想为 One Works 创建一个语音转文字服务配置。

请先询问我服务商、接口地址、鉴权方式、模型名、语言、音频格式限制和返回 JSON 结构。
然后基于 One Works 的 voice.speechToText 配置格式生成可写入配置文件的 JSON。

约束：
- 不要把 API key 明文写进 project 配置，优先使用环境变量引用。
- 服务 id 使用小写 kebab-case。
- 如果是 OpenAI 兼容接口，provider 使用 openai-transcriptions。
- 如果是自定义 HTTP 接口，provider 使用 custom-http，并补齐 request/response 映射。
- 最后给出测试步骤和失败排查建议。
```

实现可以复用现有会话创建流程。如果当前还没有 composer 预填能力，应增加一个轻量 pending draft 机制，不要把整段提示词塞进 URL。
