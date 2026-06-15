# RFC 0006 细节：Relay 团队配置共享架构

返回入口：[RFC 0006: Relay 团队配置共享](./0006-relay-team-config-sharing.md)

## 数据模型

```ts
interface RelayTeam {
  id: string
  slug: string
  name: string
  description?: string
  createdByUserId: string
  archivedAt?: string
  createdAt: string
  updatedAt?: string
}

interface RelayTeamMember {
  id: string
  teamId: string
  userId: string
  role: 'owner' | 'admin' | 'editor' | 'member' | 'viewer'
  defaultForPublishing?: boolean
  createdByUserId: string
  createdAt: string
  updatedAt?: string
}

interface RelayConfigProfile {
  id: string
  teamId: string
  name: string
  description?: string
  status: 'draft' | 'published' | 'disabled'
  activeVersionId?: string
  createdByUserId: string
  updatedByUserId?: string
  createdAt: string
  updatedAt?: string
}

interface RelayConfigProfileVersion {
  id: string
  profileId: string
  version: number
  allowedFields: RelayConfigSafeField[]
  configPatch: RelayConfigPatch
  secretRefs?: Record<string, string>
  sourceHash: string
  createdByUserId: string
  changeNote?: string
  createdAt: string
}

interface RelayConfigProfileAssignment {
  id: string
  profileId: string
  versionId?: string
  priority: number
  target: { userIds?: string[]; teamIds?: string[] }
  project?: { allow?: string[]; deny?: string[] }
  mode: 'default' | 'override'
  enabled: boolean
  createdAt: string
  updatedAt?: string
}
```

存储驱动第一阶段继续共享 normalized Relay store。Postgres 和 SQLite 后续可以把这些对象拆成表，但 route/service 不能依赖具体 driver。

`RelayTeamMember` 对 `(teamId, userId)` 建唯一约束，不限制 `userId` 只出现一次；`defaultForPublishing` 只是分享默认团队偏好，不参与授权。

## Snapshot 语义

Snapshot 计算必须是确定性的：

1. 解析已认证用户。
2. 解析该用户在当前租户内的所有有效团队成员关系和角色。
3. 汇总这些团队里可消费的 profile assignment。
4. 按设备项目上下文过滤。
5. 按 `priority`、`updatedAt`、`id` 排序。
6. 按顺序合并 patch。
7. 附加冲突诊断和来源信息。

Snapshot 响应新增：

```ts
interface RelayConfigSnapshotProvenance {
  teamId: string
  teamName?: string
  profileId: string
  profileName: string
  versionId: string
  version: number
  assignmentId: string
  mode: 'default' | 'override'
  fields: RelayConfigSafeField[]
}
```

每个已应用字段都应该能追溯到 team、profile、version 和 assignment。这是插件界面、审计复核和支持排障的共同前提。

## API 边界

团队 API：

- `GET/POST /api/relay/teams`
- `GET/PATCH /api/relay/teams/:teamId`
- `POST /api/relay/teams/:teamId/archive`
- `GET/POST /api/relay/teams/:teamId/members`
- `PATCH/DELETE /api/relay/teams/:teamId/members/:userId`

配置共享 API：

- `GET/POST /api/relay/teams/:teamId/config-profiles`
- `GET/PATCH /api/relay/config-profiles/:profileId`
- `POST /api/relay/config-profiles/:profileId/versions`
- `POST /api/relay/config-profiles/:profileId/publish`
- `POST /api/relay/config-profiles/:profileId/assignments`
- `PATCH /api/relay/config-assignments/:assignmentId`
- `POST /api/relay/config-profiles/:profileId/secrets/rotate`

Admin API 可以在 `/api/admin/*` 下为租户管理员提供镜像入口。用户自助流程使用 `/api/relay/*`，并先检查租户策略，再做 session 鉴权和团队授权。

## 校验

分享草稿校验：

- 第一版接受声明型协作字段：`modelServices`、`defaultModelService`、`recommendedModels`、`plugins`、`marketplaces`、`skills`、`skillsMeta`、`skillRegistries`。
- `plugins` 只共享插件声明、scope、启用状态和 schema 可校验 options；带 password/secret 语义的 option 必须转成 secret ref。
- `skills` 只共享声明和 metadata，不自动安装不可信远端内容；安装仍需要显式动作和 lockfile 记录。
- `modelServices` 条目归一化成展示元数据和 secret ref，`defaultModelService` 与 `recommendedModels` 必须引用可见 service key。
- `env`、hooks、MCP servers、shell permissions、本地路径、未知 config root 和 adapter-native secret block 第一版拒绝。

即使插件界面已经过滤字段，服务端也必须重新校验。

## 密钥处理

Secret store 要求：

- 只保存 encrypted payload。
- 记录 `secretVersion`、`createdByUserId`、`rotatedAt` 和 `revokedAt`。
- 所有 list/detail 响应都必须脱敏 secret。
- 记录上传、轮换、撤销和 snapshot 交付事件。

显式共享模式：

- Relay 验证设备、成员和版本后，为目标设备生成 envelope encrypted payload。
- Snapshot 不返回 plaintext，只返回 ciphertext、algorithm、keyId、secretVersion、expiresAt 和 recipientDeviceId。
- 插件用本地私钥解密，plaintext 只进入内存；如果落盘缓存，仍保存密文。
- HTTPS 仍必需，但不是唯一秘密边界；即使传输日志被记录也看不到 secret。

代理模式：

- 代理模式是团队或租户可选策略，不是默认要求。
- Snapshot 把模型服务 `apiBaseUrl` 指向 Relay proxy。
- 设备收到临时 Relay credential，而不是 provider API key。
- Relay 使用服务端 secret 转发模型 API 流量，团队需要接受额外服务器压力和成本。
- 该模式需要独立的 rate limit、审计、成本控制和容量告警。

## 缓存和撤销

插件缓存行为：

- 不含 secret 的 snapshot 可以离线使用，但必须展示提醒。
- 含 secret 的 snapshot 必须有有界 TTL，默认不超过 24 小时。
- 如果 `mustRefreshAfter` 已过且刷新失败，除非策略显式允许 grace mode，否则 hook 必须停止应用 secret-bearing config。
- UI 必须区分已同步、已应用、已过期、已撤销和项目未命中状态。

撤销触发：

- 移除团队成员、归档团队、禁用 profile、发布替代版本、轮换或撤销 secret、禁用用户、禁用设备。

## Admin 界面

Relay Admin 增加这些领域：

团队页包含可搜索列表、成员、角色过滤、归档操作和审计摘要；配置 profile 页包含版本历史、assignment 表、发布/禁用和 secret rotation；用户详情页展示团队成员关系和继承的 config profiles。

Admin 列表页必须遵循现有表格约定：搜索、过滤、列配置、批量操作入口、固定表头、底部分页、图标操作按钮，以及主识别字段上的详情链接。

## Relay 插件界面

Relay 插件增加：

当前远端配置来源 team/profile/version、分享草稿构建器、团队选择、安全字段预览、API key 警告、密钥模式选择，以及带过期和撤销警告的 refresh/apply 状态。

插件绝不能自动上传配置。共享必须从用户显式动作开始，最终提交界面必须展示所有将离开本机的字段和 secret。

## 迁移说明

- 现有 `user.teamIds` 可以迁移成 synthetic `RelayTeamMember` 记录。
- 现有 raw `configAssignments` 继续可读，兼容手写 store data 的私有部署。
- Once profile assignments exist, Admin should stop exposing raw assignment JSON editing.
- Snapshot contract should remain backward compatible for existing Relay plugin versions by keeping `assignments`, `hash`, `version`, and safe config fields.

## 服务边界

Routes 只处理 auth、请求解析和响应；团队成员关系和 config profile 逻辑放在 server services；存储驱动保持 permission-agnostic；Relay 插件负责本地预览和缓存应用；Relay Admin 只负责管理界面，不能重写服务端校验。
