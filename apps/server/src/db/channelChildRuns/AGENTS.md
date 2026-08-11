# Channel Child Runs DB Module

本目录维护 `channel_child_session_runs` 的 schema 和 repo。

它记录每次 channel inbound 消息被 dispatch 到 runtime session 的事实：触发频道、actor、消息、实体、sessionId、dispatch mode 和状态。`dispatched` 只表示已投递给 runtime，必须保持 `completedAt` 为空；runtime store watcher 通过 `services/channel-lifecycle` 幂等写入 terminal 状态并触发 memory writeback。只允许 terminal 状态写入完成时间。`memorySnapshotId` 与 `continuitySnapshotJson` 是本轮注入审计锚点。

## 文件职责

- `schema.ts`：创建 `channel_child_session_runs` 与 channel / actor / session 查询索引。
- `repo.ts`：row <-> domain 映射，以及 create / finish / get / listRecent。

## 约束

- 不要把 tool permission 细节塞进这里；权限明细属于 `channel_authorization_requests`、`channel_command_runs.metadata.approval` 或未来 tool-call audit。
- `metadataJson` 只放轻量调试信息，例如 content kind、model route、runtime content 是否存在；不要存原始大消息或 credential secret。
