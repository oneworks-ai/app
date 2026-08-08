# channel-authorizations 服务说明

- `index.ts`：对外 facade，只重导出授权请求的创建、处理和送达入口。
- `interaction-request.ts`：把 channel session 权限交互镜像为带稳定 id 的授权请求。
- `pending-intents.ts`：创建关联 pending intent，并构造 resolved intent 的 resume metadata。
- `resolution.ts`：统一处理 grant / deny、原 interaction 续接和 pending intent 收敛。
- `delivery.ts`：记录授权请求送达状态和默认送达节流。
- `metadata.ts` / `types.ts`：模块私有的 metadata 规范化、裁决摘要和交互绑定类型。

这里不做完整 ApprovalPolicyResolver，也不存凭证 secret。它只负责把“当前 channel 会话需要某项权限”变成可查询、可审批、可审计的授权请求状态，并在授权请求被送达或处理后同步更新关联的 `channel_pending_intents`。实际 grant / deny 由这里统一调用 session interaction response 入口续接，并在 resolved intent 上写入 `metadata.resume`：原 interaction 已经续接成功时标记 `skipped`，否则标记 `ready` 供后续 system-child resume 消费。镜像时可以调用 `services/channel-approval` 生成裁决摘要并写入 metadata，但策略逻辑仍归 channel-approval。

适合来这里的任务：

- 将 session `interaction_request(kind=permission)` 同步为 channel authorization request。
- 给同步出的授权请求补充 `metadata.approval`，保留 sender/canonical user、capability、resolver status 和 reasonCode。
- 为后续私信/ephemeral/管理后台授权入口生成稳定 pending request。
- 把 channel command `/auth list|grant|deny` 和自动权限请求状态打通。
- interaction request 已经发送到频道后，按 `dm` / `public_hint` 记录 delivery 和 delivery message id，并写入 `channel_reply_throttles`，默认 20 分钟内不重复发送同一个 authorization request。
- grant / deny 授权请求时同步更新 `channel_pending_intents`，并保留 `metadata.resume.status=ready|skipped`；`metadata.resume.mode` 来自 channel link 的 `authorization.resume`，默认 `immediate`。不要在命令层直接只写 `channel_authorization_requests`。
