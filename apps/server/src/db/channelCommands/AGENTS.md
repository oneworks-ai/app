# channelCommands DB 目录说明

- `schema.ts`：维护 `channel_command_runs`，记录 channel command fast path 的执行审计。
- `repo.ts`：提供 command run 创建、完成、查询最近记录 API。

这里记录“谁在什么频道触发了哪个命令、权限级别、结果状态和错误”，不执行命令本身，也不负责权限裁决。

适合来这里的任务：

- 为 slash command / typed channel command 增加审计。
- 查询 channel command 最近执行记录。
- 后续把 slash fast path 与 agent callable command tool 的 run 记录统一。
