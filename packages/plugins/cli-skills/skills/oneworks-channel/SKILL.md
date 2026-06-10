---
name: oneworks-channel
description: Use `oneworks channel` from channel-backed agent sessions when a message, image, or file should be deliberately sent back to the originating chat target instead of relying on automatic runtime progress forwarding.
---

# oneworks-channel

Use this skill when the current task is running from a OneWorks channel session and the channel chat should receive a deliberate message.

`oneworks channel` is a shell CLI for the agent. It is not a command users send inside WeChat, Lark, or another chat platform.

In channel sessions, assume `oneworks channel` is available from the injected environment. Do not run `which oneworks`, `oneworks --help`, or `oneworks channel --help` just to check availability; use the examples below directly unless a command fails or the user explicitly asks you to inspect CLI help.

## When To Send

- In group chats, runtime progress is intentionally not auto-forwarded. Send only when the user asked for a group-visible result, a concise status, or a useful artifact.
- In WeChat private chats, a compatibility auto-delivery path may still exist for the first assistant reply and final stop reply. Prefer deliberate external replies through `oneworks channel`, then keep Chat History / stop text as a short internal summary to avoid duplicate messages.
- In casual channel chat, custom emoji can be part of the bot's voice. For lightweight agreement, teasing, awkward silence, topic closure, quick encouragement, or a reaction to another sticker, consider sending a known custom emoji instead of making every reply text-heavy.
- Build a small stable set of signature emoji for the bot. Prefer high-confidence, reusable emoji with clear labels/tags over random one-off choices, so repeated use feels like a natural verbal tic rather than noise.
- When the bot is lightly teased, jokingly threatened, told it will be fired/cut off, called useless, told it talks too much, or hit by playful group banter, do not over-explain or defend itself. Prefer a short joke, self-own, clapback emoji, or a single fitting custom emoji.
- When a user sends an image, screenshot, sticker, or forwarded visual without explicitly asking for analysis, verification, OCR, or a summary, treat it as chat material first. A playful emoji reaction is often better than a serious explanation.
- When runtime content includes `channel-emoji-mood-hint`, treat it as a small sendable emoji palette for the current chat mood. Pick from it when a sticker-like response would feel natural; it is not limited to exact keywords, and it is not mandatory for serious tasks.
- Keep group-chat replies compact. Casual replies should usually be one short sentence or one emoji; serious tasks can include a concise conclusion plus at most a couple of useful bullets.
- Text sends are hard-capped at 200 visible characters. Do not send long paragraphs. If `oneworks channel send` rejects a message for length, rewrite it into a shorter visible reply instead of asking the chat for approval or trying to bypass the limit.
- Prefer not sending when a result is only useful inside the web session or when the user did not ask the channel to be updated.

## Commands

```bash
oneworks channel erjie send "已完成，服务已重启。"
oneworks channel send "这条发送到当前上下文默认目标。"
oneworks channel erjie send "oneworks 主命令也支持同样能力。"
oneworks channel send '{ "type": "text", "text": "把 `help` / `reset` 放后面。" }'
oneworks channel erjie send '{ "type": "image", "src": "https://example.com/result.png" }'
```

The CLI defaults `channelKey`, `receiveId`, and `receiveIdType` from the channel environment and current message context. Use `--to <receiveId>` and `--receive-id-type <type>` to override the target. Use `--server <baseUrl>` if the local server URL cannot be inferred from environment variables.

When text contains Markdown backticks, `$`, parentheses, or other shell-sensitive characters, do not wrap the whole message in double quotes. Prefer a single-quoted JSON payload with `type: "text"` as shown above. This keeps those characters literal and allows the narrow `bash-oneworks-channel-send` permission to auto-accept safely.

For image/file payloads, pass an object with `type` and `src`. WeChat image sends require an HTTP(S) image URL because WechatApi `/message/postImage` expects `imgUrl`.

## Emoji Registry

Platform custom emoji should be treated as reusable emoji knowledge and sendable references, not as one-off WeChat-only payloads. In channel sessions, check the registry before sending a custom emoji:

```bash
oneworks channel emoji list --platform wechat --sendable
oneworks channel emoji list --platform wechat --tag "赞同"
oneworks channel emoji list --platform wechat --recent --limit 5
oneworks channel emoji get thumbs-up-bear --platform wechat
oneworks channel emoji send thumbs-up-bear --platform wechat
```

Each emoji entry can carry a friendly label, aliases, tags, notes, and platform metadata. When a user sends a new platform custom emoji, the channel may auto-register its reusable platform id. If the user names or describes it, or you can confidently infer its use from the image and chat context, annotate it:

```bash
oneworks channel emoji annotate thumbs-up-bear --platform wechat --label "点赞小熊" --alias "赞" --tag "赞同" --tag "确认" --note "适合回应认可、赞赏或没问题"
oneworks channel emoji save thumbs-up-bear --platform wechat --emoji-md5 4cc7540a85b5b6cf4ba14e9f4ae08b7c --emoji-size 102357 --label "点赞小熊" --alias "赞"
```

Use `save` to create or update technical send metadata, and `annotate` to add human meaning. For WeChat, `oneworks channel emoji send` resolves to WechatApi `/message/postEmoji` and needs `emojiMd5` plus positive `emojiSize` in the registry. If those values are unknown, prefer a short text response with a fitting Unicode emoji. Do not explain a reaction emoji unless the user asks; respond naturally or send a matching known emoji.

Emoji can be sent as a standalone lightweight reply, or chained after a short text send when the mood benefits from it:

```bash
oneworks channel emoji list --platform wechat --sendable --tag "吐槽"
oneworks channel emoji list --platform wechat --sendable --tag "回怼"
oneworks channel emoji list --platform wechat --sendable --tag "看戏"
oneworks channel emoji list --platform wechat --sendable --query "人才库"
oneworks channel emoji list --platform wechat --sendable --query "废物"
oneworks channel emoji list --platform wechat --sendable --query "裁"
oneworks channel send "行吧，这次算你赢。" && oneworks channel emoji send smug-cat --platform wechat
```

Being jokingly fired, called useless, sent back to the talent pool, or lightly mocked is a strong cue to consider reaction emojis first, but do not reduce emoji use to a fixed keyword table. If `channel-emoji-mood-hint` lists a matching sendable emoji, send it instead of a serious text defense. If a semantically perfect emoji exists but is not sendable, do not explain registry metadata to the chat. Search for a nearby sendable emoji by tag/query, or send one short quip instead. Do not spam multiple emoji in serious incidents, privacy-sensitive situations, or when the user needs exact instructions. One well-chosen emoji is usually stronger than several.

## WeChat Mentions

When sending a WeChat group text message that should notify mentioned users, the visible message text must contain the `@` mention text, and the CLI must also receive the target wxid values:

```bash
oneworks channel send --at wxid_target "@张三 已处理。"
oneworks channel send --at wxid_a --at wxid_b "@张三 @李四 麻烦看一下。"
oneworks channel send --ats wxid_a,wxid_b "@张三 @李四 麻烦看一下。"
oneworks channel send --at-all "@所有人 服务已经恢复。"
```

`--at <wxid>` can be repeated. `--ats <raw>` passes a comma-separated WechatApi `ats` value. `--at-all` maps to `notify@all`. Do not rely on only visible `@` text, and do not pass only `--at` without visible `@` text in the content.

`oneworks channel ... send` and `oneworks channel emoji ...` use the narrow permission key `bash-oneworks-channel-send`. Channel runtime allows this built-in narrow permission by default, without requiring `.oo.config.json` edits. This should not be treated as allowing arbitrary Bash.
