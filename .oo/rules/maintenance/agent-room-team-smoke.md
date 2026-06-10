# Team Smoke / Agent Room Team 验证流程

本流程用于验证 Agent Room team 多实体链路。验证必须在真实 Chrome 的当前 room 页面完成，不能只看 API、数据库或后端日志。每轮都使用唯一 token，例如 `leader-ack-001`、`reviewer-ack-001`、`planner-ack-001`，避免误判旧消息。

验证 token 只能作为自然语言消息里的可检索标识，不能单独作为用户可见消息正文。所有被投影到 room 的消息都必须能被人读懂，例如「planner 发给 reviewer 的验证消息，token 是 xxx，请确认收到」；不要发送或要求实体只输出 `xxx-p2r` 这类裸 token。

## 前置

- 启动后端与前端，打开当前 room URL，例如 `/ui/rooms/<roomId>?senderHeader=collapsed&verify=<token>`。
- 在真实 Chrome 中刷新页面后检查消息流、权限卡片、quote 链接、target chip 与视觉样式。
- 如使用 CDP 或 Playwright 辅助，仍以页面 DOM、computed style、bounding rect 和截图结果为准，不用 API 结果替代 UI 验收。

## 1. 启动 team

发送：

```text
启动项目的俩个实体，让他们向我进行介绍。
```

通过标准：

- room 中保留用户原始消息。
- 出现 `std/dev-planner joined` 与 `std/dev-reviewer joined`。
- 权限申请展示为可操作消息卡片，而不是普通纯文本。
- 两个子实体的自我介绍都投影到 room。
- leader 最终汇总投影到 room。

## 2. 续发 leader

发送普通群聊消息，不写 `@leader`，并带唯一 token：

```text
续发测试 leader-ack-001：请确认你能收到这条给 leader 的消息，并用一句话回复「leader 收到」。
```

通过标准：

- 消息目标是 leader。
- leader 回复投影到 room。
- leader 回复里的 quote 指向这条用户消息，quote 文案和跳转正确。
- 正文不出现多余的 `@...`、目标路由或 Role 文本。

## 3. 续发 subagent

分别发送给 reviewer 与 planner，每条都使用唯一 token：

```text
@std/dev-reviewer 续发测试 reviewer-ack-001：请只回复「reviewer 收到 reviewer-ack-001」。
@std/dev-planner 续发测试 planner-ack-001：请只回复「planner 收到 planner-ack-001」。
```

通过标准：

- 用户主动消息保留 target chip 与目标元信息。
- 对应子实体回复投影到 room，且不会丢消息。
- quote 指向对应用户消息，target、badge、agent 身份正确。
- 子实体正文不夹带多余 `@...`、目标路由或 Role 文本。

## 4. 验证 leader 主动下发

发送给 leader，要求它向某个子实体下发带唯一 token 的消息：

```text
请向 std/dev-reviewer 下发一条包含 token leader-to-reviewer-001 的消息，要求对方精确回复「reviewer 收到 leader-to-reviewer-001」。完成后总结你已下发并收到回复。
```

通过标准：

- 用户消息进入 leader。
- 目标 subagent 独立回复，并包含要求的精确 token。
- leader 最终总结说明已下发且已收到回复。
- room 中能区分 subagent 的独立回复与 leader 的最终总结。

## 5. 验证 subagent 互发

发送给 leader，要求两个子实体双向发送自然语言验证消息：

```text
请协调一次子实体双向消息验证，token 为 subagent-cross-001。
1. 让 std/dev-planner 向 std/dev-reviewer 发送一条自然语言消息：「planner 发给 reviewer 的验证消息，token 是 subagent-cross-001-p2r，请确认收到」；要求 reviewer 精确回复「reviewer received subagent-cross-001-p2r from planner」。
2. 让 std/dev-reviewer 向 std/dev-planner 发送一条自然语言消息：「reviewer 发给 planner 的验证消息，token 是 subagent-cross-001-r2p，请确认收到」；要求 planner 精确回复「planner received subagent-cross-001-r2p from reviewer」。
请不要只由 leader 总结，必须让目标子实体实际收到并回复，并在总结中列出两个子实体 sessionId、相关事件 id 和精确回复。
```

通过标准：

- 两个子实体都已经是 room member，并且有可定位的 sessionId。
- room 中能看到发送方的自然语言验证消息或对应可读总结，不能只出现裸 token。
- 目标子实体分别给出精确回复，且回复作为目标子实体消息投影到 room。
- leader 最终总结列出发送方 sessionId、目标 sessionId、事件 id 和精确回复。
- 如果 runtime 需要对目标子 session 做显式 `session.message` 投递，消息内容仍必须保持自然语言可读，并说明是来自哪个子实体。

## 6. UI 回归重点

- 用户主动消息不可丢；子实体回复不可丢。
- 权限申请必须展示为可操作消息卡片，pending 时按钮可点击，handled / expired 时显示状态。
- 普通消息、quote、badge 不应出现多余 `@...`、目标路由或 Role 文本。
- 用户 targeted bubble、child reply bubble、leader quote 的 padding 与宽度要视觉一致；quote 贴合外层 bubble，不出现异常窄卡或右侧空白。
- 验证消息必须可读，不能把裸 token 或临时机器标识当成最终 room 消息。
- 每次验证都更换唯一 token，并在失败记录中保留 room URL、token、截图或 CDP 读取到的关键 DOM / computed style。
