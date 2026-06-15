---
rfc: 0006
title: Relay 团队配置共享
status: draft
authors:
  - Codex
created: 2026-06-16
updated: 2026-06-16
targetVersion: vNext
---

# RFC 0006: Relay 团队配置共享

细节页：[架构细节](./0006-relay-team-config-sharing-architecture.md)、[租户策略](./0006-relay-team-policy.md)

## 摘要

Relay 需要从“按 `teamIds` 过滤配置下发”的底层原语，升级成完整的团队配置共享系统：用户可以创建团队、管理成员、把自己选择的可共享配置发布为团队配置，团队成员的设备再通过 Relay 拉取并应用这些配置。

核心判断：

- 当前 `RelayUser.teamIds` 和 `RelayConfigAssignment.target.teamIds` 只解决下发匹配，不解决团队生命周期、成员权限、配置所有权、版本、审批、密钥和撤销。
- 团队共享配置必须是一个独立产品域，不能把用户本地 `.oo.config` 原样上传，也不能把团队共享建模成 admin 手填 JSON。
- 第一版应支持团队共享声明型配置，包括模型服务、插件和 skills。成本不在“多读几个配置字段”，而在每类字段的密钥、本地路径、自动安装和执行权限治理。
- 长期需要支持两种密钥模式：显式共享模式把共享密钥下发到成员设备；代理模式把 API key 留在 Relay 服务端。

## 当前状态

已有能力：

- Relay server 可以保存用户 `teamIds`。
- Config assignment 可以通过 `target.userIds` / `target.teamIds` 和 project allow/deny 下发。
- Relay plugin 可以同步本地 snapshot，并通过 config hook 应用安全字段。

缺口：

- 没有 `Team`、`TeamMember`、团队邀请、团队角色或团队审计。
- Admin user API 不读写 `teamIds`，更没有用户自助团队 API。
- Config assignment 没有 owner、profile、version、draft/published 状态或审批。
- 用户无法从本地配置选择性发布到团队。
- 密钥会跟随 `modelServices` 下发，当前没有专门的共享确认、加密、轮换、撤销 TTL 和审计模型。

## 目标

- 用户可以创建团队，并作为团队 owner 管理成员。
- 用户可以把模型服务、插件、skills 等声明型配置发布成团队配置 profile。
- 团队 owner/admin/editor 可以维护 profile、版本和 assignment。
- 一个用户可以加入同一租户内的多个团队，并从多个团队同时继承配置。
- 团队 member 的设备按用户、团队、项目规则获得配置 snapshot。
- Relay plugin 可以展示配置来源、版本、启用状态、是否命中项目、是否已应用，以及缓存是否过期。
- 成员移除、team archive、profile disable、secret rotate 后，客户端不会无限期使用旧的 secret-bearing snapshot。
- 所有共享行为可审计。

## 非目标

- 不把用户完整 `.oo.config` 同步到云端。
- 不把所有 config 字段无差别纳入第一版。第一版覆盖 `modelServices`、`defaultModelService`、`recommendedModels`、`plugins`、`marketplaces`、`skills`、`skillsMeta`、`skillRegistries` 这类声明型协作配置；`env`、`mcpServers`、`permissions` 和本地路径类字段需要单独安全设计。
- 不把团队配置和项目源码绑定为强制策略。项目匹配只是 assignment 条件。
- 不在第一版实现企业级 SCIM、目录同步、跨 Relay 租户联邦。

## 产品概念

- 租户：一个 Relay deployment 的账号边界。官方托管服务和每个私有部署都是独立租户。
- 团队：租户内的协作空间，拥有成员、配置 profile、密钥和审计记录。
- Profile：可共享配置的逻辑单元，例如“设计团队 Claude”或“工程团队插件集”。
- 版本：profile 的不可变发布版本。编辑产生草稿，发布产生新版本。
- Assignment：把某个 profile 版本绑定到目标用户、团队和项目规则。
- Snapshot：对某个用户和设备即时计算的可应用配置视图。

## 多团队成员关系

用户不限制只能加入一个团队。成员关系按 `(teamId, userId)` 唯一，一个用户可以在不同团队拥有不同角色，例如在 A 团队是 owner，在 B 团队是 member。

团队数量不是权限边界，真正的边界是租户、团队成员关系、团队角色和 profile assignment。Snapshot 计算时需要汇总用户所有有效团队里可消费的配置，再按项目规则、优先级和模式合并。移除某个团队成员关系时，只撤销该团队带来的配置，不影响用户从其他团队继承的配置。

界面可以提供“默认发布团队”或“当前查看团队”，但这只是交互偏好，不能写成账号级单团队限制。

## 角色

全局 Relay role 继续控制 tenant 级管理能力。Team role 控制团队内能力：

| 角色   | 能力                                                        |
| ------ | ----------------------------------------------------------- |
| owner  | 删除或归档 team，管理 owner/admin/editor/member，发布配置。 |
| admin  | 管理成员，发布配置，禁用 profile。                          |
| editor | 创建 draft，提交发布，维护 assignment。                     |
| member | 消费团队配置，查看自己可见的 profile 元数据。               |
| viewer | 只读团队和 profile 元数据，不消费 secret-bearing config。   |

全局 owner/admin 默认拥有所有团队权限，但操作仍写入团队审计。

## 权限

新增权限建议：

- `teams.read`, `teams.write`
- `team.members.read`, `team.members.write`
- `team.configs.read`, `team.configs.write`, `team.configs.publish`
- `team.configs.consume`
- `team.secrets.rotate`

团队作用域权限必须由用户 session、团队成员关系、全局角色三者共同判断。Device token 只能消费已经授权给所属用户的 snapshot，不能调用团队管理 API。

## 租户策略

团队能力先由站点管理员在租户策略里开启和限额，再由团队 owner/admin 在允许范围内使用。策略需要覆盖是否允许自助建团队、最大团队数、最大团队成员数、profile/assignment 上限、可用密钥模式、proxy mode 是否开放、secret TTL、插件白名单和 skills 来源白名单。Proxy mode 尤其不能由团队单方面开启，避免把模型流量无意压到 Relay 服务端。

## 共享流程

1. 用户创建团队或加入现有团队。
2. Relay 插件界面中选择“共享配置到团队”。
3. 本地 runtime 从可共享字段构建分享草稿，包括模型服务、插件声明和 skills 声明。
4. 界面展示每个共享项、来源、是否包含密钥、是否会触发远程安装或启用插件。
5. 用户选择密钥模式：
   - 显式共享模式：secret 加密存储在 Relay，并在 snapshot 中交付给成员设备；
   - 代理模式：secret 留在 Relay 服务端，设备只拿到 Relay 代理服务。
6. 服务端校验字段，写入草稿版本，并记录审计。
7. 团队 owner/admin/editor 发布版本。
8. Assignment 把版本绑定到 user/team/project 规则。
9. 设备同步 snapshot，应用配置，并上报 `lastAppliedAt`、`matchedProject`、profile/version 和缓存过期状态。

## 架构

需要新增这些领域对象：

- `RelayTeam`
- `RelayTeamMember`
- `RelayConfigProfile`
- `RelayConfigProfileVersion`
- `RelayConfigProfileAssignment`
- `RelayConfigSecret`
- `RelayConfigAuditEvent`

`RelayConfigAssignment` 可作为兼容层保留，但新 snapshot 应从 profile assignment 计算。数据模型、API 边界、snapshot 计算、密钥和缓存策略见架构细节页。

## 配置分层决策

Relay managed config 必须成为命名层，而不是静默并入 `userConfig`。默认优先级：

```text
runtime/env > local private/dev overrides > local user config > relay remoteManaged > project config
```

团队 owner 可把 assignment 标记为 `override`，但插件界面必须明确展示远端策略是强制策略。第一版可以继续沿用当前 hook 机制实现，但状态和契约必须暴露来源、优先级和强制标记。

## 密钥决策

Secret handling 是这项能力最难的部分：

- 上传 API key 必须有显式确认和审计。
- 服务端持久化只能保存加密后的 secret payload。
- Admin/team API 永不回显 plaintext。
- Snapshot API 不传 plaintext；显式共享模式只下发按设备公钥加密的 secret payload，本地插件解密后使用。
- 每个 secret-bearing snapshot 都必须带 `expiresAt`、`secretVersion` 和 `mustRefreshAfter`。
- 代理模式是可选策略，不是默认要求；只有团队明确选择集中代理、审计或成本控制时才让模型流量经过 Relay。

## 推进计划

阶段 1：团队基础能力

- 增加 team/member 类型、store 归一化、repository 测试、RBAC helper 和 API 测试。
- 增加 Admin 团队列表、详情和成员管理。
- 如果已有 `user.teamIds`，迁移成 synthetic membership。

阶段 2：配置 profile 基础能力

- 增加 profile/version/assignment 类型和服务端 snapshot 派生逻辑。
- 保留现有 raw `configAssignments` 作为兼容输入。
- 在 snapshot 契约中增加来源和缓存过期字段。

阶段 3：用户共享流程

- 增加插件分享草稿构建器和团队发布 API。
- 增加 Admin profile/version/assignment 管理界面。
- 增加模型服务、插件、skills 等共享字段的服务端校验。

阶段 4：密钥治理强化

- 增加 encrypted secret store、轮换、撤销 TTL 和审计。
- 增加代理模式作为推荐生产路径。
- 增加 secret-bearing snapshot 的过期停用行为。

## 验证

- 服务端 route 测试覆盖团队 CRUD、成员授权和团队作用域配置消费。
- Store 测试覆盖 JSON、SQLite、Postgres 序列化和 encrypted secret redaction。
- Snapshot 测试覆盖 user/team/project 过滤、优先级、来源和撤销。
- Plugin 测试覆盖分享草稿脱敏、snapshot cache 过期、已应用状态和项目未命中。
- Admin 测试覆盖 teams、members、profiles、assignments 和 secret rotation 表单。
- Smoke：创建团队，邀请成员，发布模型服务、插件和 skills 配置，连接第二台设备，验证配置应用，移除成员，再验证刷新后停止应用 secret-bearing config。

## 待确认问题

- 官方 Relay 默认配额、申请提额流程和 proxy mode 开放策略是什么？
- 带密钥的配置发布是否需要第二个 owner 审批？
- 专用 `remoteManaged` 配置层落地前，本地 user config 和远端团队配置的默认优先级是什么？
- 项目匹配只使用显式 `projectId` 和 workspace basename，还是也加入 git remote fingerprint？
- 模型服务代理模式的最小可行范围是什么，如何避免把 Relay 扩成完整模型网关？
