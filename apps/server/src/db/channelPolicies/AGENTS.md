# channelPolicies DB 目录说明

- `schema.ts`：维护频道策略运行态表，包括固定回复节流与下班 backlog。
- `repo.ts`：保持 `createChannelPoliciesRepo` 与公开类型出口，只负责装配子 repo。
- `throttle-record.ts` / `throttle-repo.ts`：reply throttle 映射、查询、清理与事务性消费。
- `backlog-record.ts` / `backlog-repo.ts`：off-hours backlog 映射、写入、查询与标记处理。
- `json.ts`：本模块共享的 JSON 安全转换。

这里存 OneWorks 自己的策略状态，不调用平台封禁 API，也不存平台权限 token。

适合来这里的任务：

- 下班期固定话术的跨重启节流。
- 被下班 gate 截断的消息进入 backlog，后续上班 digest 或人工处理。
- 后续软屏蔽、限流、策略审计事件等 channel policy 运行态。
