---
name: oneworks-mem
description: 说明 agent 如何用 oneworks mem CLI 在 channel、session、user、global 维度读写持久记忆，并判断什么时候应该读取、追加或更新记忆。
---

当任务发生在 channel 会话里，或用户要求保存、读取、整理长期上下文时使用这个 skill。`oneworks mem` 是给 agent 在 shell 中调用的 CLI，不是发送到聊天频道里的文本命令。

在 channel 会话中，默认认为 `oneworks mem` 已经由环境注入可用。不要为了确认是否存在而先执行 `which oneworks`、`oneworks --help` 或 `oneworks mem --help`；直接按下面示例调用，只有命令失败、参数不确定且示例不足，或用户明确要求时才查询 help。

在 channel 会话中，不要让模型自己抄写平台 id。`oneworks mem` 会从环境变量和 server 写入的当前消息上下文文件读取 session id、channel id、群聊当前发送者 sender id 等元数据。群聊里多人轮流说话时，`-s user` 默认指向当前这条消息的发送者。

## 快速命令

- `oneworks mem get`：读取当前默认记忆文件，等价于当前 channel id 下的 `README.md`。
- `oneworks mem patch "内容"`：向当前默认记忆文件追加内容。
- `oneworks mem set "内容"`：覆盖当前默认记忆文件，只有明确要重写时使用。
- `oneworks mem list`：列出当前 scope 下已有记忆文件；不传 `-p` 时列出全部路径。

所有 subcommand 都支持：

- `-p, --path <path>`：指定或过滤 id 下的相对文件路径。`get` / `set` / `patch` 默认 `README.md`，`list` 不传时不过滤路径。
- `-c, --channel <channel>`：指定或过滤 channel，例如 `wechat`。
- `-f, --filter <id>`：指定或过滤平台相关 id。对 `get` / `set` / `patch` 是目标 id，对 `list` 是过滤条件。
- `-s, --scope <scope>`：记忆维度，支持 `channel`、`user`、`session`、`global`。

## Scope 选择

- `channel`：默认 scope。用于当前群聊、私聊、帖子或平台会话的长期上下文；适合频道主题、项目背景、群约定、常用配置、长期排障线索。
- `user`：用于当前发送者个人相关信息；适合姓名、称呼、职责、稳定偏好、常用工作方式。只在信息来自本人、被明确确认，或对任务持续有用时写入。群聊中不要手填 sender id，让 CLI 从当前消息上下文解析。
- `session`：用于当前 OneWorks session 的临时工作记忆；适合本次任务状态、排查步骤、未完成 TODO、刚形成但未必长期有效的结论。
- `global`：用于跨频道也成立的通用事实或用户明确要求全局记住的规则；谨慎使用。

## 什么时候读取

优先在这些场景读取相关记忆：

- 用户提到“之前”“上次”“按老配置”“记得我说过”“继续那个问题”等跨轮上下文。
- 任务需要知道频道长期背景、平台 id、项目约定、常见故障、用户偏好或之前的决策。
- 当前请求含糊，但已有记忆可能决定正确做法。
- 在群聊或私聊中遇到不熟的人、昵称、群内梗、项目名、表情含义、图片语境或关系距离，且这些信息会影响回复语气或任务判断时，先读小本本，不要只靠猜。
- 用户问“你知道 X 吗”“你还记得 X 吗”，或你准备吐槽/接梗但不确定上下文时，先 `oneworks mem get` / `oneworks mem get -s user` / `oneworks mem list`。
- 准备写入前，先 `get` 或 `list`，避免重复、冲突或把同一主题写到多个地方。

常用读取：

```bash
oneworks mem get
oneworks mem list
oneworks mem get -s user
oneworks mem get -s session
oneworks mem get -p ./reference/wechat.md
```

## 什么时候写入

写入应服务于未来任务，不要把普通流水账塞进记忆。适合写入：

- 有人主动介绍自己，例如姓名、称呼、职责、项目角色、联系方式偏好。
- 用户给出稳定偏好，例如回复语言、排查顺序、审批习惯、常用模型或工具选择。
- 频道形成稳定背景，例如群聊讨论的项目、接入方式、服务地址、常见命令、长期约定。
- 一次较长讨论产生明确结论，例如问题根因、修复方案、还未做的后续动作。
- 任务中发现可复用的事实，例如某平台 id 的含义、某 webhook 的配置注意事项。
- 你刚刚从聊天中理解了一个原本不熟的群友、群内梗、项目名、表情用法、互动边界或话题背景，并且它会帮助未来更自然地回应。

写入时尽量和当前聊天话题保持一致：同一主题聚合到同一个文件，摘要短而可执行，避免跨主题混写。
不要只在 Chat History 里写“我会记住”或“应该记录”；需要记忆时要真的调用 `oneworks mem patch`，让工具调用记录出现在过程里。

## 写入格式建议

默认 `README.md` 适合放简短总览。复杂主题用 `reference/<topic>.md` 或 `topics/<topic>.md`：

```bash
oneworks mem patch "用户偏好：希望排查链路时先验证公网入口，再看服务日志。"
oneworks mem patch -s user "用户自我介绍：二姐，主要维护 WeChat channel 接入。"
oneworks mem patch -s session "本次排查：已确认 webhook secret 正确，下一步检查回调日志。"
oneworks mem patch -p ./reference/wechat.md "WechatApi 重连后需要重新注册 callback。"
```

对已有内容做结构化整理时，可以读取后再 `set` 覆盖，但只在你确信重写会提升质量时使用：

```bash
oneworks mem get -p ./reference/wechat.md
oneworks mem set -p ./reference/wechat.md "整理后的内容..."
```

`oneworks mem` uses the narrow permission key `bash-oneworks-mem`. Channel runtime allows this built-in narrow permission by default, without requiring `.oo.config.json` edits. This should not be treated as allowing arbitrary Bash.

## 不应该写入

- 密码、token、密钥、cookie、验证码、私有证书或其他凭据。
- 未确认猜测、模型自己的推断、短期情绪、无复用价值的寒暄。
- 大段原始日志、长对话全文、代码 diff。只保存未来需要的摘要和索引。
- 与当前任务无关的敏感个人信息。即使来自用户本人，也要判断是否确实有助于未来任务。

如果命令失败，要让用户感知失败原因；不要假装记忆已经保存。
