# 诊断、遥测与支持包

One Works 使用 OpenTelemetry（OTel）作为传输标准，使用自己的窄诊断事实模型作为产品契约。这样 One Works、Codex 和其他支持 OTLP/HTTP JSON 的工具可以进入同一条分析链路，同时不会把日志文本、提示词或凭据当成默认埋点上传。

## 能回答什么

| 角色      | 主要问题                                                                              | 对应分析                                                 |
| --------- | ------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| 产品      | 启动成功率是多少、典型和长尾等待多久、哪个版本退化、多少用户受影响                    | 启动 outcome、P50/P95、版本/平台/来源分布、影响用户数    |
| 研发      | 失败发生在哪个阶段、属于客户端/网络/认证/存储哪一域、是否可重试、同一会话是否连续失败 | 稳定失败码、failure domain、stage、duration、匿名关联 ID |
| 测试      | 用例是否走完预期阶段、超时/取消/降级是否可区分、升级后是否出现 abandoned 操作         | operation 状态机、stage 顺序、终态、上次中断恢复         |
| 支持      | 用户说“打不开/很慢”时，能否在不索取项目内容的情况下定位                               | 用户诊断时间线、安全支持包、版本/平台、失败码            |
| 运维/安全 | 采集是否可控、保存多久、谁能查看、是否可能带入敏感内容                                | 用户/设备鉴权、Admin 权限、30 天与数量上限、字段白名单   |

这套能力不只判断“有没有报错”，还会区分：开始、阶段切换、用户可用、稳定运行和最终结束。启动成功与 P50/P95 以“用户看到可用界面”为准，不以进程创建或稳定等待窗口结束为准；达到可用后又发生后台问题时可以记录为 `degraded`，避免把可用用户误算为完全失败。

## 数据流

```text
One Works Desktop / Web / PWA / CLI ─┐
                                     ├─ OTLP/HTTP JSON ─ Relay 隐私投影与保留 ─ Admin 稳定性看板
Codex OTel ──────────────┘

One Works 本地诊断事实 ─ 安全支持包（手动交给支持人员）
```

Relay 的接收地址是：

```text
POST <relay-origin>/api/relay/diagnostics/v1/logs
Content-Type: application/json
Authorization: Bearer <user-access-token-or-device-token>
X-OneWorks-Team-Id: <team-id>
```

当前只接收 OTLP/HTTP JSON，不接收 protobuf 或 gRPC。单次请求最多 1 MiB / 512 条 log record。Relay 按已认证的用户和其拥有的设备绑定身份，忽略客户端声明的用户 ID，避免串号或伪造。不发送 `X-OneWorks-Team-Id` 时，用量只进入当前用户的个人空间；显式发送该 header 或使用团队级访问令牌时，用量才进入团队空间。Relay 会校验有效成员关系，不能借 header 伪造其他团队，也不会把同一事件同时记入个人和团队统计。

## 数据与诊断控制

- “数据与诊断”是统一的数据出口控制面，诊断、性能、功能使用和模型服务统计作为独立类别管理；不要再用其中某一种埋点给整个配置页命名。当前 Relay 首个可配置类别是“模型服务统计”。
- 个人空间的模型服务统计默认开启。安装并登录 Relay 插件后，开关位于独立的“账号 → 数据与诊断”标签页；未启用 Relay 或 Relay Server 不支持任何可配置类别时不展示此标签页。关闭后应用不会构造个人空间的 `oneworks.model.usage` 事件，也不会向 OTLP exporter 发出这类请求。
- 团队策略由 Relay Server 按团队下发并显示在“账号 → 团队 → 具体团队 → 数据与诊断”。每个团队拥有独立策略；只有该团队允许成员选择时才显示“我的模型服务统计”开关，团队 owner/admin 可以在该团队详情中切换统一上报或成员可选。
- 登录 Relay 后，应用偏好会与 Relay 的“个人资料 → 数据与诊断”中的“模型服务统计”类别双向同步，并依据偏好更新时间解决多设备冲突。Relay 端仍做第二道校验，避免旧版本客户端或独立采集器绕过个人偏好。
- 团队空间默认使用“团队统一上报”，成员不能自行关闭。团队 owner/admin 可以改为“成员可选上报”；切换后每名成员仍默认开启，但可以只对该团队关闭自己的上报。
- 用户自己的 Model Service 只受个人开关控制，不受任何团队策略限制。Relay 团队配置下发的 Model Service 会携带来源团队标记，只受该团队的策略和成员在该团队内的偏好控制；其他团队策略不会串用。
- 开关只控制 Model Service 数字用量事实，不改变普通产品诊断事件的采集配置。
- “系统诊断”默认开启并可由个人关闭远端上报。无论是否上报，应用仍在本机保留有界的无内容诊断事实，便于用户主动导出支持包；关闭时不会向 Relay 或其他 OTLP 端点发送。

## JavaScript 异常

Web / PWA 会捕获 React 渲染异常、`window.error`、未处理 Promise rejection 和客户端 bootstrap 失败；Electron 另外捕获主进程致命异常与 renderer 进程退出。相同异常在 5 秒内去重，并限制每分钟最多 20 个客户端异常，避免异常风暴影响应用或产生失控成本。

异常在离开捕获进程前就被归一化，只保留稳定失败码、安全错误类型和基于错误类型/stack 形状生成的截断 SHA-256 指纹。message、rejection 原值、stack、URL、文件路径和 React component stack 都不会进入本地事实、IPC、HTTP 请求或 OTLP payload。Admin 可以按指纹聚合同一类异常，但不能从指纹还原原始内容。

Codex 是独立进程，One Works 的应用开关不能改写 Codex 自己的 OTel 配置。关闭 Relay 个人偏好后，Relay 会丢弃 Codex 发来的个人用量；若希望请求也完全不离开本机，还需要在 `~/.codex/config.toml` 中关闭或移除 Codex exporter。

## One Works OTLP 配置

Desktop 与 CLI 支持标准 OTel 环境变量：

```bash
export OTEL_EXPORTER_OTLP_LOGS_ENDPOINT="https://relay.example.com/api/relay/diagnostics/v1/logs"
export OTEL_EXPORTER_OTLP_LOGS_PROTOCOL="http/json"
export OTEL_EXPORTER_OTLP_LOGS_HEADERS="authorization=Bearer%20<user-access-token>"
```

One Works 会根据当前 Model Service 的来源自动选择个人空间或具体团队，并为团队服务附加经过 Relay 校验的 `x-oneworks-team-id`；不要用一个静态团队 header 把用户自己的服务错误归入团队。独立采集器如果明确只代表一个团队，仍可显式发送该 header。

也可以设置基础地址 `OTEL_EXPORTER_OTLP_ENDPOINT`，One Works 会补 `/v1/logs`。使用 Relay 的自定义路径时应直接设置 `OTEL_EXPORTER_OTLP_LOGS_ENDPOINT`。批次、超时和临时错误重试在客户端处理；遥测发送失败不会阻断用户启动或 CLI 命令。

## Codex OTel 接入 Relay

Codex 的 `otel` 必须写在用户级 `~/.codex/config.toml`；项目内 `.codex/config.toml` 不允许改变遥测路由。建议保持提示词导出关闭：

```toml
[otel]
environment = "prod"
log_user_prompt = false
exporter = { otlp-http = { endpoint = "https://relay.example.com/api/relay/diagnostics/v1/logs", protocol = "json", headers = { "authorization" = "Bearer owrt_REPLACE_WITH_ACCESS_TOKEN", "x-oneworks-team-id" = "TEAM_ID" } } }
```

上例会进入团队空间；个人空间配置应省略 `x-oneworks-team-id`。

把示例中的访问令牌直接替换为 Relay 个人访问令牌。Codex 当前会按字面值发送 header，不会在这个字段里展开 `${ENV_VAR}`。

Relay 会识别 Codex 的 API、SSE/WebSocket、会话、工具决策和工具结果类事件，但只保留事件名、成功/失败、耗时、稳定错误类型和匿名关联 ID。即使上游 log body 中出现提示词、工具结果片段或任意文本，Relay 也不会保存该 body。

## 个人、平台与团队 Model Service 用量

登录用户可以在 `/admin/profile/diagnostics` 的“数据与诊断”标签页查看个人空间跨设备汇总、安全明细和模型服务统计开关。团队策略与成员在该团队内的偏好放在对应团队详情中，不在个人页面汇总配置。

平台 owner/admin 可以打开 `/admin/model-usage` 查看所有团队的请求、输入/输出/缓存 token、活跃团队、跨团队活跃成员、缓存命中率、P95 耗时、每日趋势、Model Service 分布和团队用量排行。可以按团队、成员、Model Service、来源和时间过滤；筛选条件保存在 URL；团队排行可以继续下钻到 `/admin/teams/:teamId/usage`。

团队 owner/admin 只能在自己的团队详情“模型用量”页查看团队内的同类指标和成员排行。平台 owner/admin 也可以进入这个团队页。平台视图和团队视图都可以导出当前筛选后的安全 JSON，但不会导出提示词或响应内容。

One Works 在 assistant 消息最终落库时记录一条 `oneworks.model.usage` 事实；Codex 的 `codex.sse_event` 在 `event.kind=response.completed` 时映射输入、输出、缓存 token 与模型。Relay 只接受稳定维度和数字计数，不保存 prompt、response、tool I/O、路径、配置或原始 log body。会话和客户端事件 ID 会哈希后再保存，重复事件按安全 ID 去重。

这是一套用于采用度、容量、性能和异常定位的“运营用量”，不等同于模型供应商账单，也不估算金额。供应商结算、配额和预算控制应继续以供应商账单或独立计费系统为准。

## Admin 分析

平台 owner/admin 可以打开 `/data-dashboard/stability`：

- 查看事件量、异常事件、影响用户数、覆盖版本/平台、启动成功率、启动 P50/P95；
- 按 One Works/Codex、版本、平台、结果、类别、时间、事件、阶段、失败码和异常指纹过滤；
- 从事件进入 `/admin/users/:userId/diagnostics`，查看单个用户的有序时间线；
- 使用 cursor 分页，筛选条件保存在 URL，便于刷新、分享和复盘。

Admin 只看到服务端归一化后的诊断事实和不透明设备关联 ID，不会借诊断页暴露其他用户的设备名称、工作区、插件范围或本地文件。

## 本地支持包

桌面端使用 `Help -> Export Diagnostic Support Bundle...`；CLI 使用：

```bash
oneworks report
oneworks report my-support-case
```

桌面支持包包含启动和 JavaScript 异常事实；CLI 支持包包含 CLI 与当前 workspace Web/PWA 的 JavaScript 异常事实。支持包只包含诊断事件、聚合摘要、产品版本与平台。事件/操作/会话等关联 ID 会做截断 SHA-256；支持包明确不包含原始日志、配置、路径、提示词、凭据、错误栈、工具输入或工具输出。即使本机没有诊断事件，也会生成一个结构有效的空支持包，方便确认版本和隐私声明。

## 保留和隐私边界

Relay 默认保留 30 天且最多 10,000 条事件，可通过以下环境变量调整：

- `ONEWORKS_RELAY_DIAGNOSTICS_RETENTION_DAYS`
- `ONEWORKS_RELAY_DIAGNOSTICS_MAX_EVENTS`
- `ONEWORKS_RELAY_RATE_LIMIT_DIAGNOSTICS_INGEST_MAX`
- `ONEWORKS_RELAY_RATE_LIMIT_DIAGNOSTICS_INGEST_WINDOW_SECONDS`

Model Service 用量默认保留 90 天且最多 100,000 条事件，可通过以下环境变量调整：

- `ONEWORKS_RELAY_MODEL_USAGE_RETENTION_DAYS`
- `ONEWORKS_RELAY_MODEL_USAGE_MAX_EVENTS`

诊断数据不得新增任意 `message`、`payload`、`stack`、`path`、`url`、`config` 或 tool I/O 字段。需要更丰富的上下文时，优先增加稳定枚举、阶段或失败码，并同步评估基数、授权、保留和支持包脱敏。
