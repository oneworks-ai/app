# RFC 0006 细节：Relay 团队租户策略

返回入口：[RFC 0006: Relay 团队配置共享](./0006-relay-team-config-sharing.md)

## 目标

团队配置共享不是团队 owner 可以无限开启的能力。站点管理员必须先在租户策略中声明哪些团队能力可用、容量上限是多少、哪些高成本或高风险模式允许使用。

该策略适用于官方托管 Relay 和私有部署。官方托管服务可以用它做产品分层和容量保护，私有部署可以用它控制团队规模、插件来源和密钥模式。

## 策略模型

```ts
interface RelayTeamPolicy {
  tenantId: string
  teamsEnabled: boolean
  selfServiceTeamCreation: boolean
  maxTeamsPerTenant?: number
  maxTeamsPerUser?: number
  maxMembersPerTeam?: number
  maxProfilesPerTeam?: number
  maxAssignmentsPerProfile?: number
  maxSecretTtlHours?: number
  allowedSecretModes: Array<'device_encrypted' | 'proxy'>
  proxyModeEnabled: boolean
  allowedPluginIds?: string[]
  allowedMarketplaceIds?: string[]
  allowedSkillSources?: string[]
  allowedSkillRegistries?: string[]
  requireOwnerApprovalForSecretProfiles?: boolean
  updatedByUserId?: string
  updatedAt?: string
}
```

`RelayTeamPolicy` 是租户级策略，不是团队级偏好。团队 owner/admin 只能在策略允许范围内选择配置共享能力。

## 强制点

所有写入路径都必须检查策略：

- 创建团队时检查 `teamsEnabled`、`selfServiceTeamCreation`、`maxTeamsPerTenant` 和 `maxTeamsPerUser`。
- 添加成员或接受邀请时检查 `maxMembersPerTeam`。
- 创建 profile 和 assignment 时检查 profile/assignment 上限。
- 发布包含 secret 的版本时检查 `allowedSecretModes`、`maxSecretTtlHours` 和审批策略。
- 选择 proxy mode 时检查 `proxyModeEnabled`，不能只由团队 owner 决定。
- 发布插件和 skills 声明时检查插件 ID、marketplace、skill source 和 registry 白名单。

读路径也需要返回策略摘要，让 Admin 和 Relay 插件能解释为什么某个按钮不可用。

## Proxy Mode

Proxy mode 会把模型请求流量、延迟、错误率和成本引到 Relay 服务端。它必须是站点管理员可控的租户能力：

- 默认可以关闭。
- 可以按租户开启，后续再扩展到按团队 allowlist。
- 开启时必须配置容量告警、rate limit、审计和成本统计。
- 团队 owner 只能在策略允许时为 profile 选择 proxy mode。

显式设备加密下发不要求模型流量经过 Relay，因此是服务器压力更小的默认设计方向。

## Admin UI

Relay Admin 需要新增租户策略页或团队设置区块：

- 展示团队能力总开关和自助创建开关。
- 配置最大团队用户数、每用户团队数、profile 数、assignment 数和 secret TTL。
- 配置允许的 secret mode 和 proxy mode。
- 配置允许共享的插件、marketplace、skill source 和 registry。
- 展示当前租户用量，接近上限时给出容量提示。

团队页和插件分享页必须读取策略摘要。达到上限或功能关闭时，界面展示原因，而不是让提交后才报错。

## 默认建议

第一版默认策略应保守：

- 允许站点管理员手动创建和管理团队。
- 自助创建团队默认由租户策略决定，官方托管服务可默认关闭。
- Proxy mode 默认关闭或按租户显式开启。
- 显式设备加密下发是默认 secret mode。
- 每团队成员数、secret TTL 和 profile 数必须有默认上限。

这些默认值不是协议常量，应该由官方服务配置或私有部署环境决定。
