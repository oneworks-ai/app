# channelIdentities DB 目录说明

- `schema.ts`：维护 channel 账号、canonical user、账号绑定、用户 credential、授权请求的 SQLite 表。
- `repo.ts`：保持 `createChannelIdentitiesRepo` 与公开类型出口，只负责装配子 repo。
- `account-record.ts` / `accounts-repo.ts`：channel account、canonical user 与账号绑定。
- `link-code-record.ts` / `link-codes-repo.ts`：短期身份绑定码及其事务性消费。
- `credential-record.ts` / `credentials-repo.ts`：用户 credential 元信息。
- `authorization-request-record.ts` / `authorization-requests-repo.ts`：授权请求状态。
- `json.ts`：本模块共享的 JSON 转换。

这个目录只保存身份与授权状态的元信息，不保存平台密钥或 OAuth token 本体。真实凭证应通过后续的 secret/keychain 层用 `credentialKey` 或 `metadata.credentialRef` 关联。

授权请求里 `requesterUserId/requesterAccountId` 表示触发消息或 command 的人，`credentialSubjectUserId` 表示需要补齐可执行凭证的人。不要把这两个概念合并；当两者不同，pending intent 应归属 credential subject。

适合来这里的任务：

- 跨飞书、微信、Telegram、Discord 等 channel 账号绑定到同一个 OneWorks 用户。
- 记录某个用户在某个 channel 下是否有可执行 credential。
- 为 channel 子会话或 channel command 记录待授权、已授权、拒绝、过期等审批状态。
