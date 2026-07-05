---
rfc: 0008
title: Relay 个人全局配置同步
status: implemented
authors:
  - Codex
created: 2026-06-30
updated: 2026-07-01
targetVersion: vNext
---

# RFC 0008: Relay 个人全局配置同步

## 摘要

Relay 账号登录后，用户期望同一个人的设备共享一份 One Works 全局配置，例如 Codex 登录态、默认账号和相关账号元信息。这个能力不应该按 Relay server、Relay 账号或设备拆成多份配置；只要用户启用了自动同步，就应该存在一份个人 canonical global config。

第一版落地范围只同步 `adapters` 根字段，重点覆盖 `adapters.codex.accounts`。Codex `auth.json` 内容以 base64 形式写入 `~/.oneworks/.oo.config.json`，避免直接明文铺在配置里；Relay 本身负责同步通道的账号与传输安全。

## 目标

- 每个 Relay user 只有一份个人全局配置快照。
- 多个 Relay server / 多个账号只是同步通道，不产生多份个人配置。
- 当前设备可以把本机 global `.oo.config.json` 中的安全字段发布到 Relay。
- 其他已登录设备可以从 Relay 拉取同一份配置，并写入本机 global `.oo.config.json`。
- 服务端使用 snapshot hash 做乐观并发控制；出现差异时保留冲突信息，后续由 UI 让用户选择保留本机或远端。
- 个人同步与 Relay 团队共享配置保持概念分离。

## 非目标

- 不同步完整 `.oo.config.json`。
- 不同步 Relay 自己的 bootstrap 配置、服务器列表、device token 或 project-local 配置。
- 不在第一版实现团队配置合并 UI。
- 不把 Codex 旧 project-local auth snapshot 自动迁移到 global config。
- 不自动合并用户在不同设备上同时编辑出的冲突。

## 个人配置模型

个人全局配置是 Relay user 维度的单例：

```ts
interface RelayPersonalConfigSnapshot {
  userId: string
  allowedFields: RelayConfigSafeField[]
  configPatch: RelayConfigPatch
  hash: string
  sourceDeviceId?: string
  updatedAt: string
  version: string
}
```

`hash` 基于 `userId`、`allowedFields` 和稳定序列化后的 `configPatch` 计算。客户端更新时携带 `baseHash`；如果服务端已有不同 hash，则返回 `409`，除非客户端显式 `force: true`。

## API

当前用户通过 Relay user OpenAPI 使用：

- `GET /api/relay/config/global`：读取当前 user 的个人全局配置快照。
- `PUT /api/relay/config/global`：用 `allowedFields`、`configPatch`、可选 `baseHash` 更新快照。

鉴权接受登录 session / user API token，也接受已注册设备的 device token；调用者必须拥有读取 managed config snapshot 的权限。Device token 只能操作它所属 user 的个人快照，不能管理团队配置。

## 客户端同步规则

Relay 插件连接成功后先同步个人全局配置，再同步团队 / assignment 产生的 effective config snapshot。

1. 从本机 global `.oo.config.json` 读取 raw config。
2. 只提取 `adapters` 安全字段。
3. GET Relay 个人快照。
4. 如果本机有配置且本机内容比远端更新，PUT 到 Relay。
5. 如果远端有配置，写入本机 global `.oo.config.json`，保留其他根字段。
6. 再继续拉取 `/api/relay/config-snapshot`，用于团队 profile / assignment overlay。

本机写入目标固定是 global One Works config，不写 project-local 配置。同步不会覆盖 `plugins.relay` 这类 bootstrap 配置，避免用户还没连上 Relay 时就依赖 Relay 来拿 Relay 配置。

## Codex 账号

Codex 登录态通过 adapter 账号系统写入：

```json
{
  "adapters": {
    "codex": {
      "defaultAccount": "default",
      "accounts": {
        "default": {
          "email": "user@example.com",
          "auth": {
            "type": "codex-auth-json",
            "encoding": "base64",
            "token": "..."
          }
        }
      }
    }
  }
}
```

账号展示名优先由账号自身 `title` 决定；如果没有 title，则 UI 可以回退到 email，再回退到 account key。不要为了让同步可用而给用户自动写入一个泛化的 `title: "Codex"`。

## 团队共享配置

Relay 团队是团队共享配置的所有者，不是第二套个人全局配置。

团队共享适合承载这些场景：

- 团队共享的 Codex 账号或 OpenAPI 平台账号。
- 团队统一的 LLM API key、模型服务、marketplace、skills、插件启用策略。
- 团队成员按角色消费不同 profile。

团队配置应继续沿用 RFC 0006 的 profile / version / assignment / secret 模型。它作为 overlay 参与 effective snapshot 计算，和个人 global config 形成分层关系：

1. 本机 bootstrap 配置：保证应用能启动并连上 Relay。
2. 个人 global config：属于当前 Relay user 的唯一同步配置。
3. Relay 团队 profile overlay：来自用户加入的 Relay teams。
4. Project-local overrides：项目内显式声明的本地覆盖。

如果个人配置和团队 overlay 对同一字段产生冲突，第一版不应静默覆盖；effective snapshot 应带 provenance，UI 后续可以提示“来自个人配置 / 团队 profile / 项目配置”的来源，让用户选择禁用某个团队来源或保留本机值。

团队共享不是“每个团队一份个人配置”。即使用户同时登录多个 Relay server、加入多个 Relay 团队，本机仍只有一份个人 global config；团队内容通过 assignment 进入当前设备的 effective config：

- 个人配置负责用户自己的默认账号、个人 Codex 登录态、个人偏好。
- 团队 profile 负责团队授予的共享能力，例如团队 Codex 账号、平台级 OpenAPI key、团队模型服务、skills registry。
- 团队 secret 继续走加密 envelope 和设备解密，不写入个人 `.oo.config.json`。
- 多个团队 profile 同时命中时，服务端应返回排序后的 assignment 与 provenance；客户端只应用 effective snapshot，不把团队 overlay 反写进个人 global config。
- 如果团队共享的账号和个人账号同 key，UI 应展示冲突来源，让用户重命名、禁用团队来源或选择优先级；不要在同步层自动把其中一份覆盖掉。
- 普通团队成员只消费合成后的 effective config，不查看团队 profile patch、版本内容或 secret metadata；只有 Relay team 的 owner/admin/editor 或显式配置管理权限成员可以查看和修改团队共享配置。

这样团队能力可以被多人共享，同时个人同步仍是“一个用户一份 canonical 配置”，不会因为多个团队、多个服务端而产生多份需要合并的个人配置。

## 验收

- Relay Server 单测覆盖个人配置保存、读取和 baseHash 冲突。
- Relay Plugin controller 单测覆盖远端个人配置写入本机 global config。
- Relay Plugin controller 单测覆盖空 / 半空本机配置不能覆盖 Relay 已有个人全局配置。
- Docker / Linux smoke 必须通过真实打包产物安装 runtime，并用 `npx oneworks daemon` 启动远端 daemon。
- Docker 内不能复制宿主机 `~/.oneworks/.oo.config.json`；必须通过 Relay 同步得到 Codex 账号配置。
- 真实远程 workspace session 能读取同步后的 Codex auth，并可以恢复 agent 对话。
