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

细节页：[Relay 团队配置共享架构细节](./0006-relay-team-config-sharing-architecture.md)

## Summary

Relay 需要从“按 `teamIds` 过滤配置下发”的底层 primitive，升级成完整的团队配置共享系统：用户可以创建团队、管理成员、把自己选择的安全配置发布为团队配置，团队成员的设备再通过 Relay 拉取并应用这些配置。

核心判断：

- 当前 `RelayUser.teamIds` 和 `RelayConfigAssignment.target.teamIds` 只解决下发匹配，不解决团队生命周期、成员权限、配置所有权、版本、审批、密钥和撤销。
- 团队共享配置必须是一个独立产品域，不能把用户本地 `.oo.config` 原样上传，也不能把团队共享建模成 admin 手填 JSON。
- 第一版应支持“共享模型服务配置到团队”，并明确限制字段、密钥、缓存和撤销语义。
- 长期需要支持两种密钥模式：把共享密钥下发到成员设备的 explicit share mode，以及 API key 留在 Relay 服务端的 proxy mode。

## Current State

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

## Goals

- 用户可以创建团队，并作为团队 owner 管理成员。
- 用户可以把本地模型服务配置发布成团队配置 profile。
- 团队 owner/admin/editor 可以维护 profile、版本和 assignment。
- 团队 member 的设备按用户、团队、项目规则获得配置 snapshot。
- Relay plugin 可以展示配置来源、版本、是否命中项目、是否已应用，以及缓存是否过期。
- 成员移除、team archive、profile disable、secret rotate 后，客户端不会无限期使用旧的 secret-bearing snapshot。
- 所有共享行为可审计。

## Non-Goals

- 不把用户完整 `.oo.config` 同步到云端。
- 不在第一版支持任意 config 字段，首批只支持 `modelServices`、`defaultModelService`、`recommendedModels`。
- 不把团队配置和项目源码绑定为强制策略。项目匹配只是 assignment 条件。
- 不在第一版实现企业级 SCIM、目录同步、跨 Relay tenant federation。

## Product Concepts

- Tenant: 一个 Relay deployment 的账号边界。官方托管服务和每个私有部署都是独立 tenant。
- Team: tenant 内的协作空间，拥有成员、配置 profile、secret 和 audit trail。
- Profile: 可共享配置的逻辑单元，例如 “Design team Claude” 或 “Engineering OpenAI”。
- Version: profile 的不可变发布版本。编辑产生 draft，发布产生新 version。
- Assignment: 把某个 profile version 绑定到目标用户、团队和项目规则。
- Snapshot: 对某个用户和设备即时计算的可应用配置视图。

## Roles

全局 Relay role 继续控制 tenant 级管理能力。Team role 控制团队内能力：

| Role   | Capabilities                                                |
| ------ | ----------------------------------------------------------- |
| owner  | 删除或归档 team，管理 owner/admin/editor/member，发布配置。 |
| admin  | 管理成员，发布配置，禁用 profile。                          |
| editor | 创建 draft，提交发布，维护 assignment。                     |
| member | 消费团队配置，查看自己可见的 profile 元数据。               |
| viewer | 只读团队和 profile 元数据，不消费 secret-bearing config。   |

Global owner/admin 默认拥有所有 team 权限，但操作仍写入 team audit。

## Permissions

新增权限建议：

- `teams.read`, `teams.write`
- `team.members.read`, `team.members.write`
- `team.configs.read`, `team.configs.write`, `team.configs.publish`
- `team.configs.consume`
- `team.secrets.rotate`

Team-scoped 权限必须由用户 session、team membership、global role 三者共同判断。Device token 只能消费已经授权给所属用户的 snapshot，不能调用团队管理 API。

## Share Flow

1. 用户创建团队或加入现有团队。
2. Relay plugin UI 中选择 “Share config to team”。
3. 本地 runtime 只从安全字段构建 share draft。
4. UI 展示每个 model service、endpoint、model list，以及 API key 是否会被共享。
5. 用户选择 secret mode：
   - explicit share mode: secret 加密存储在 Relay，并在 snapshot 中交付给成员设备；
   - proxy mode: secret 留在 Relay 服务端，设备只拿到 Relay proxy service。
6. Server 校验字段，写入 draft version，并记录 audit。
7. Team owner/admin/editor 发布版本。
8. Assignment 把版本绑定到 user/team/project 规则。
9. 设备同步 snapshot，应用配置，并上报 `lastAppliedAt`、`matchedProject`、profile/version 和缓存过期状态。

## Architecture

需要新增这些领域对象：

- `RelayTeam`
- `RelayTeamMember`
- `RelayConfigProfile`
- `RelayConfigProfileVersion`
- `RelayConfigProfileAssignment`
- `RelayConfigSecret`
- `RelayConfigAuditEvent`

`RelayConfigAssignment` 可作为兼容层保留，但新 snapshot 应从 profile assignment 计算。数据模型、API surface、snapshot 计算、密钥和缓存策略见架构细节页。

## Config Layering Decision

Relay managed config 必须成为命名层，而不是静默并入 `userConfig`。默认优先级：

```text
runtime/env > local private/dev overrides > local user config > relay remoteManaged > project config
```

Team owner 可把 assignment 标记为 `override`，但 plugin UI 必须明确展示远端策略是 mandatory。第一版可以继续沿用当前 hook 机制实现，但 status 和 contract 必须暴露 source、precedence 和 mandatory 标记。

## Secret Decision

Secret handling 是这项能力最难的部分：

- 上传 API key 必须有显式确认和 audit。
- Server 持久化只能保存 encrypted secret payload。
- Admin/team API 永不回显 plaintext。
- Snapshot API 只有在 explicit share mode 下，才可以向授权消费设备返回 plaintext。
- 每个 secret-bearing snapshot 都必须带 `expiresAt`、`secretVersion` 和 `mustRefreshAfter`。
- proxy mode 是推荐生产路径，因为 API key 不离开 Relay。

## Rollout Plan

Phase 1: Team foundation

- Add team/member types, store normalization, repository tests, RBAC helpers, and API tests.
- Add Admin team list/detail and member management.
- Backfill existing `user.teamIds` into synthetic memberships if present.

Phase 2: Config profile foundation

- Add profile/version/assignment types and server snapshot derivation.
- Keep existing raw `configAssignments` as compatibility input.
- Add provenance and cache expiry fields to snapshot contract.

Phase 3: User share flow

- Add plugin share draft builder and team publishing API.
- Add Admin profile/version/assignment UI.
- Add validation that only safe fields can be shared.

Phase 4: Secret hardening

- Add encrypted secret store, rotation, revocation TTL, and audit.
- Add proxy mode as preferred production path.
- Add stale cache shutdown behavior for secret-bearing snapshots.

## Verification

- Server route tests for team CRUD, member authorization, and team-scoped config consumption.
- Store tests for JSON, SQLite, Postgres serialization, and encrypted secret redaction.
- Snapshot tests for user/team/project filtering, precedence, provenance, and revocation.
- Plugin tests for share draft redaction, snapshot cache expiry, applied status, and project miss.
- Admin tests for teams, members, profiles, assignments, and secret rotation forms.
- Smoke: create team, invite member, publish model service, connect second device, verify applied config, remove member, verify refresh stops applying secret-bearing config.

## Open Questions

- Should self-service team creation be enabled by default on official Relay, or gated by tenant policy?
- Should profile publish require approval by a second owner for secret-bearing configs?
- What is the default precedence between local user config and remote team config before the dedicated `remoteManaged` layer lands?
- Should project matching use only explicit `projectId` and workspace basename, or also git remote fingerprints?
- What is the minimum viable proxy mode for model services without turning Relay into a full model gateway?
