# Channel Memories DB Module

本目录维护结构化 channel memory、每次 dispatch 的持久 snapshot 与 terminal writeback 审计。repo 只负责存取；privacy filter、排序、预算和 prompt renderer 属于 `services/channel-memory/`。

记忆读取必须在 service 层同时约束 channelKey、entity、canonical user/account、visibility、sensitivity 与 expiry，不能让调用方直接拼 SQL 绕过这些边界。
