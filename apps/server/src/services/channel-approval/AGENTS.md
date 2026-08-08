# channel-approval 服务说明

- `index.ts`：对外 facade，只重导出 resolver 与公开类型。
- `resolver.ts`：最小 ApprovalPolicyResolver，按触发 sender、频道管理员配置、用户 credential 状态和 capability 返回 allow / ask / deny 类裁决。
- `authorization-request.ts`：为需要授权的裁决创建稳定 request id，并幂等 upsert 对应 pending intent。
- `types.ts`：公开输入、裁决和 credential requirement 类型。
- `values.ts`：模块私有的身份引用规范化和管理员匹配。

这里负责“能不能执行”的裁决，不保存 token secret，也不直接向外部频道发送私信、ephemeral 或授权链接。需要创建 pending 授权状态时，只写 `channel_authorization_requests`，后续送达策略由 channel runtime 或管理后台处理。

适合来这里的任务：

- 判断 channel command、channel tool 或未来 child session action 是否可按当前 sender 执行。
- 为 child session permission mirror 提供 `defaultDecision`，在不改变旧 permission-check 协议的前提下，把“本次需要触发用户确认”的状态统一成 resolver 摘要。
- 区分 `actor identity` 与 `actor credential`：身份用于权限和审计，credential 只在用户明确授权后用于个人 API。
- 为缺失、过期或 scope 不足的 credential 生成稳定授权请求。
