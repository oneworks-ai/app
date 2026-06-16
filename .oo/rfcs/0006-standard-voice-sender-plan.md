# RFC 0006: Sender 交互与落地

返回入口：[标准语音能力](0006-standard-voice-capability.md)

## Sender 入口

在聊天 sender 操作行左侧增加语音按钮，初始图标为 `mic`。第一阶段支持主聊天 sender 和 embedded session sender。inline edit 需要先确认编辑态插入和取消语义，后续再接入。

没有已启用服务时：

1. 第一次点击把按钮区域展开为内联配置提示。
2. 提示说明需要配置语音转文字服务，并展示配置动作。
3. 点击配置动作跳转到 `/config?section=voice.speechToText`。

已有服务时：

- 左键使用当前选择或默认服务开始录音。
- 右键打开菜单，展示服务列表、当前默认标记、“本次使用”、“设为默认”和“配置语音转文字”。

## 录音 UI

录音时用紧凑录音条替换普通 sender 操作行：

```text
[+]  ---------------- waveform ----------------  0:06  [stop] [send]
```

行为：

- 开始录音前记录 editor selection 和内容版本。
- 将 editor 设为只读，并在视觉上弱化。
- 隐藏普通行按钮，避免动作冲突。
- 展示已录制时长和 Web Audio analyser 生成的波形。
- `Esc` 取消录音、丢弃音频、恢复 editor，不调用服务。

录音条方向上对齐截图：波形居中，计时靠右，停止/发送为圆形控制按钮，主表面不放额外说明文字。

## 状态机

```text
idle
  -> setupPrompt
  -> recording
recording
  -> cancelled
  -> transcribing(stopIntent=insert)
  -> transcribing(stopIntent=send)
transcribing
  -> inserted
  -> submitted
  -> failed
failed
  -> retrying
  -> idle
```

停止动作：

1. 立刻停止 media tracks。
2. 构造音频 blob。
3. 调用 `/api/voice/speech-to-text`。
4. 把结果插入到捕获的光标位置。
5. 恢复 editor 可编辑状态和 focus。

发送动作走同一路径，但在插入成功后继续触发现有 sender submit。

## 插入语义

插入目标是录音前捕获的 cursor range。如果 editor 内容版本在只读期间仍发生变化，客户端应退回到当前光标位置插入，并展示非阻塞警告。空转写结果不修改 editor。

空白处理：

- 如果插入点左右都是非空白字符，在转写文本两侧补空格。
- 如果转写文本已经以句末标点结尾，不额外补标点。
- 保留现有附件和上下文引用。

## 失败行为

服务调用失败时：

- 保持原始 editor 内容不变。
- 恢复 editor 可编辑状态和 focus。
- 在内存中保留录音 blob，直到用户重试、重新录音、编辑 composer 或离开页面。
- 展示内联错误状态，并按需提供重试、选择服务和配置动作。
- 如果用户点击的是发送动作，转写失败后不能提交消息。

具体映射：

- `NO_DEFAULT_SERVICE`、`SERVICE_NOT_FOUND`、`MISSING_CREDENTIAL`：展示配置动作。
- `MICROPHONE_PERMISSION_DENIED`：展示浏览器权限引导。
- `NO_SPEECH_DETECTED`：提示未识别到语音，保持 editor 不变。
- `PROVIDER_RATE_LIMITED`、`PROVIDER_TIMEOUT`、`NETWORK_ERROR`：展示重试和选择服务。

## 可访问性与 i18n

- 所有按钮文案、菜单项、错误和配置页文本都走 i18n。
- 图标按钮必须有 `aria-label`。
- 计时器更新不能持续打扰屏幕阅读器；只在状态切换时通过 polite live region 暴露录音状态。
- 键盘支持：`Esc` 取消；发送控制聚焦时 `Enter` 停止并发送；`Space` 触发当前聚焦按钮。

## 落地计划

阶段 1：契约与服务端运行时。

- 增加共享 `voice` 类型和配置 schema。
- 增加服务解析和脱敏后的服务列表。
- 增加 `openai-transcriptions` 和 `custom-http`。
- 增加默认选择、缺失凭证、脱敏和服务失败的 route tests。

阶段 2：配置 UI。

- 增加 `voice.speechToText` section。
- 增加服务编辑器、默认选择器、测试动作和 AI 辅助接入按钮。
- 增加中英文 i18n keys。

阶段 3：Sender 消费。

- 在 sender 下增加语音输入 hook 和组件。
- 增加右键菜单服务选择。
- 增加录音条、波形、插入、转写后发送和重试。

阶段 4：加固。

- 按需支持更多 provider 类型。
- 增加可选音频转码。
- 增加浏览器兼容 fallback。
- 增加不留存转写文本/音频的使用诊断。

## 验收标准

- 用户可以在配置中设置默认语音转文字服务，并在配置页看到它。
- 未配置服务时，sender 语音按钮展示配置流程。
- 录音时展示计时和波形，隐藏冲突 sender 控件，并让 editor 只读。
- 停止动作把转写文本插入到原始光标位置。
- 发送动作只在转写和插入成功后提交消息。
- 右键菜单可以选择服务并打开配置页。
- provider 错误不会修改 editor 内容，也不会自动发送。
- API 响应、日志和配置诊断中密钥都已脱敏。

## 验证

聚焦命令：

```bash
pnpm exec vitest run --workspace vitest.workspace.ts --project node packages/config/__tests__/schema.spec.ts
pnpm exec vitest run --workspace vitest.workspace.ts --project node apps/server/__tests__/voice.spec.ts
pnpm exec vitest run --workspace vitest.workspace.ts --project bundler.web apps/client/__tests__/sender-voice-input.spec.tsx
```

更广检查：

```bash
pnpm typecheck
pnpm exec dprint check
pnpm exec eslint .
```

手工回归：

- Chrome 桌面端：允许权限、拒绝权限、停止、发送、重试、右键菜单。
- 窄屏布局：按钮配置流程和录音条不出现文本重叠。
- 深色/浅色主题：波形、计时、停止/发送控制保持可读。
