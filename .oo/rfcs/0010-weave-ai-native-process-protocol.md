---
rfc: 0010
title: Weave AI Native Process Protocol
status: draft
authors:
  - Codex
created: 2026-08-18
updated: 2026-08-18
targetVersion: vNext
---

# RFC 0010: Weave AI 原生流程协议

跟踪议题：[#386](https://github.com/oneworks-ai/app/issues/386)。

返回入口：[RFC 索引](../../rfc.md)。

## 摘要

Weave 是面向 AI 编码与协作过程的协议和状态层。它把团队认可的过程表达为固定路径的 Workflow、具有稳定契约的 Node，以及 Node 内可替换的 Action；它还保存可呈现的任务图、依赖、状态和证据。

Weave 不执行传统工作流引擎的条件分支、循环或 shell 编排，也不成为自己的 agent scheduler。Codex、Claude Code 和其他 host agent loop 保持执行、委派与并行决策权；Weave 为这些循环提供过程语义、可恢复状态和团队治理边界。

本 RFC 是设计草案。文中的目录、JSON 与字段用于讨论互操作边界，不构成首版实现或稳定 schema 承诺。

## 背景与问题

AI 编码过程常同时需要两类能力：一类是开发者自然地与 agent 协作，另一类是团队把评审、风险、证据和授权沉淀为可复用标准。把前者硬编码为传统 DAG/脚本引擎会限制 agent 的判断；完全依赖 prompt 又难以表达固定团队过程、状态可视化和不可弱化的政策。

Weave 提议把“过程”与“执行”分开：前者由可读、可审计的协议描述，后者继续由已经在场的 agent runtime 完成。这样同一过程可以服务不同 host，而不会复制现有运行时或绑死某一个技能生态。

## 目标

- 用固定 Workflow 路径和 Node 契约描述可复用的 AI 原生过程。
- 允许 Node 内的实现随团队、成员和 host 改变，同时保留过程级验收。
- 统一记录任务、依赖、就绪性、状态和证据，使宿主可以呈现任务图。
- 支持复杂度重新判断，并在保留已有产物的前提下建议切换固定流程。
- 支持仓库中的自然语言触发，也保留显式调用方式。
- 让 Spec Kit、Superpowers、host 原生行为和团队 skills 作为可替换 provider。

## 非目标

- 不实现 if/else、循环、重试、shell 管道或通用工作流执行器。
- 不创建第二个 agent scheduler，不决定委派对象、并发数或执行顺序。
- 不替代 RFC 0004 的 CLI runtime protocol、runtime store 或其执行引擎。
- 不要求 Python、Spec Kit 或任一具体 host 安装后才能使用 Weave core。
- 不将本草案的示例文件格式承诺为公开稳定 API。

## 三种视角

### Weave core

Core 只定义过程对象、状态语义、解析与校验边界，以及可选 provider 的发现接口。它负责让同一 Workflow、Node 契约和任务图被不同 host 一致理解；它不接管 host 的工具调用或进程生命周期。

### 建设标准与定制的团队

团队维护固定路径、Node 契约、政策和模板，把“什么时候需要规格、评审、证据或人工确认”变成共享标准。团队可以允许成员选用不同 Action，但提交的团队政策是下限，local override 不能删除、放宽或绕过它。

### 使用 Weave 的开发者

开发者在仓库中直接提出需求，例如“修复登录超时并补回归测试”。AGENTS 或 host integration 把请求路由到适用的 Workflow；开发者仍可显式调用 Weave。开发者看到的是清晰的当前 Node、待满足验收、任务图和证据，而非必须学习一套脚本语言。

## 概念模型

```text
Workflow --选择固定路径--> Node --选择可替换实现--> Action
                                  |
                                  +--> Task graph / status / evidence
```

### Workflow

Workflow 选择一条固定的 Node 路径，例如“快速修复”或“跨模块设计”。它可以定义入口分类、路径顺序和允许的升级目标，但不在运行时计算任意条件分支。路径固定让团队能讨论过程和覆盖率，而不是为每次运行生成新的编排程序。

### Node

Node 是过程中的稳定关卡，定义：

- `goal`：此阶段要达成的目的；
- `input`：开始时必须已有的上下文或产物；
- `output`：成功后产生或更新的产物；
- `acceptance`：可检查的完成条件和所需证据；
- `transition`：满足后可进入的下一个固定 Node，或可提出的升级建议。

Node 契约属于过程层。它不规定用哪条命令、哪个模型或哪一个子 agent 才能完成目标。

### Action

Action 是 Node 内的可替换实现。例如“形成规格”这个 Node 可由 Spec Kit、团队 skill、host 内置规划行为或人工协作完成。Action 必须声明它能消费的输入、产出的证据类型和所需授权；它不能偷偷改变 Node 的目标、验收或 transition。

## AI 原生执行边界

Weave 面向的是能理解上下文并作出判断的 agent loop，而不是确定性流水线。host agent 根据当前信息决定何时执行一个 Action、是否委派、如何并行、何时暂停向用户提问，以及如何恢复。Weave 接收这些决定的过程结果并验证它们是否满足 Node 契约。

因此，一个 host 可以选择串行完成三个 ready task，另一个 host 可以同时委派它们；只要依赖、授权和 Node acceptance 得到遵守，两者都符合 Weave。任何需要传统条件、循环或 shell 编排的自动化，应留在 host、CI 或独立工具，而不扩展 Weave core。

## 任务图与状态

Weave 为任务图标准化最小事实：

- `task`：任务标识、所属 Node、目标、输入和输出引用；
- `dependency`：任务间必须先满足的关系；
- `readiness`：依赖、授权和输入是否齐备的可解释结论；
- `status`：建议使用 `pending`、`ready`、`active`、`blocked`、`completed`、`failed`、`cancelled` 等有限状态；
- `evidence`：产物位置、命令结果、审阅结论、用户确认或外部链接的可追溯记录。

这些事实足以让 CLI、IDE 或产品 UI 渲染图、时间线和阻塞原因。图是状态投影，不是调度命令：host agent 始终决定执行、委派和并行性。状态更新必须保留来源和时间，避免“已完成”只是一句不可验证的模型文本。

### 运行记录与恢复

一次 Weave run 是某个 Workflow 在具体仓库与请求上的过程记录，而不是新的执行会话。它至少绑定 Workflow snapshot、适用的 policy snapshot、Node 进度、任务图和 evidence 引用。host 可以把 run 关联到 RFC 0004 的一个或多个 session，也可以在没有该 runtime 的环境中保存 run。

恢复时，解析器应先检查冻结的 Workflow/政策引用仍可读取；若资产已经变化，UI 或 host 必须区分“按原快照继续”“迁移到新定义”和“需要重新评估”。已验收 Node 的证据不可因重新打开 run 而静默丢失。run 不保存 agent 私有推理、密钥或不必要的完整终端记录。

这种记录让团队能够追问“为什么此时允许进入下一 Node”，同时不要求 Weave 拥有进程、模型上下文或 scheduler 的恢复职责。

## 复杂度升级

初始分类只是开始时的建议，不是不可变承诺。执行中的 Action 或 Node 可以基于新证据触发重新评估，例如发现跨模块影响、权限风险、数据迁移或无法覆盖的验收面。

重新评估可以建议切换到另一条固定 Workflow。切换时应保留已有任务、证据和已生成产物，并建立新旧 Node 的可追溯映射；不应把已完成工作伪装成未发生。若切换会改变范围、风险或授权，host 必须取得用户确认后才继续。仅是更换 Action 或不改变上述边界的流程细化，可按团队政策自动继续。

## 团队标准与本地定制

团队可以提交 Workflow 路径、Node 契约、政策、模板和允许的 Action 集合。团队也可以让成员在政策许可范围内偏好不同 Action，例如某成员使用团队 review skill，另一成员使用 host 的原生审阅步骤。

配置合并遵循“高层政策不可被低层削弱”的原则：团队提交的强制 Node、必需 evidence、禁止 provider、授权要求和审批门槛是下限。项目或成员本地层可以增加约束、选择允许的 Action、填写私有凭据引用或改善显示设置；若 local 配置删除必需关卡、降低证据要求或扩大授权，解析必须失败并说明冲突来源。

## 可选 provider 与 Action

Weave 把下列能力视为 Action provider，而非 core 依赖：

- Spec Kit：规格、计划或模板驱动的过程实现；
- Superpowers：已安装的专业工作流或工具能力；
- host 原生行为：Codex、Claude Code 等提供的规划、审阅、测试或委派能力；
- 团队 skills：仓库或团队维护的专用动作实现。

provider 只在被选中的 Action 需要时才发现、加载或调用。缺少某 provider 时，解析器应报告可替代 Action 或不可满足的 Node，不能使 Weave core 失效。特别地，core 不依赖 Python，也不以安装 Spec Kit 为前置条件。

## 仓库级对话触发

开发者不必记住显式 CLI 命令。仓库的 AGENTS、host integration 或等价入口可以识别自然语言请求，加载适用的 Weave 资产并路由到推荐 Workflow。路由应在开始时向开发者说明所选流程及关键政策，并允许显式 invocation 用于脚本、调试或强制选择。

对话触发不是隐式授权。涉及范围扩大、外部写入、权限提升或工作流切换时，仍适用 Node 与 host 的确认规则。

## 建议资产布局

以下是项目级 `.weave` 的建议布局，名称和字段仍为草案：

```text
.weave/
  manifest.json
  config.json
  config.local.json
  workflows/
  nodes/
  actions/
  plugins/
  plugins.local/
  hooks/
  policies/
  templates/
  plugins.lock.json
  runs/
```

- `manifest.json`：格式版本、入口和可发现资产的最小声明。
- `config.json`：可提交的项目默认选择、团队标准引用和非敏感设置。
- `config.local.json`：个人或机器本地覆盖，例如偏好、路径和凭据引用，默认不提交。
- `workflows/`、`nodes/`、`actions/`：过程定义与 Action provider 绑定。
- `plugins/`：受项目或团队管理、可提交的插件内容。
- `plugins.local/`：本地安装或私有插件，默认不提交。
- `hooks/`：将仓库/host 事件映射到 Weave 路由的适配层，不承担 scheduler。
- `policies/`：不可由本地层削弱的团队约束。
- `templates/`：Node 或 Action 可使用的产物模板。
- `plugins.lock.json`：已解析插件标识、版本、来源和完整性信息。
- `runs/`：可恢复的运行状态、任务图和证据索引，默认不提交，除非团队显式选择审计归档。

建议 `.gitignore` 至少忽略 `config.local.json`、`plugins.local/` 和 `runs/`，并忽略可能存放机器解析结果的插件缓存。是否提交 `plugins.lock.json` 取决于团队是否需要可复现 provider 解析；若提交，它不得含密钥、绝对私有路径或用户身份信息。

### 配置层

建议有效配置按以下顺序合并：

```text
manifest defaults < config.json < committed policies < config.local.json
```

这里的“后者优先”只适用于普通可覆盖字段。政策应用单调合并：local 层能增加限制，不能弱化已提交政策。插件解析结果通过 lockfile 固化，而不是让每次运行静默取得不同远端版本。

### 说明性示例

```json
{
  "formatVersion": "0-draft",
  "defaultWorkflow": "fast-fix",
  "workflows": ["workflows/fast-fix.json"],
  "policyRoots": ["policies/team.json"]
}
```

```json
{
  "id": "review",
  "goal": "确认变更满足范围与风险要求",
  "acceptance": ["review evidence is recorded"],
  "transition": { "next": "verify" },
  "actions": ["host-review", "team-review-skill"]
}
```

示例只表达模型：真实实现可以选择 JSON、YAML 或经验证的等价格式，并需另行定义版本迁移、字段扩展和诊断行为。

## 与既有 RFC 的关系

RFC 0005 定义项目托管 skills 的声明、安装和 lock 语义。Weave 可以把已安装的团队 skill 作为 Action provider，但不重新定义 remote source、依赖下载或 skills lockfile。

RFC 0004 定义 CLI runtime protocol、runtime store 与执行引擎边界。Weave 可以引用其 session、事件和证据，也可以被产品层投影；但不复制 runtime engine、命令事件模型或 session 调度。两者的关系是过程语义叠加于运行时事实之上，而不是互相替代。

## 安全与信任

- 默认把本地 Action、hook 和 plugin 视为可执行代码；发现不等于获得执行权限。
- provider 必须声明需要的权限、网络访问和外部写入类别，host 继续执行实际授权检查。
- lockfile 和来源完整性用于降低供应链漂移；敏感值只允许引用，不写入 manifest、证据或运行状态。
- evidence 可能含路径、命令输出或外部链接，应支持最小化记录、脱敏和按团队保留策略清理。
- 读取团队政策、解析 local override 和选择 Action 必须产生可解释诊断，避免以 prompt 优先级悄悄绕开标准。
- 恢复 run 时应验证 Workflow、政策和 provider 解析是否仍兼容；不兼容时暂停并要求重新评估或用户确认。

## 兼容性与诊断

Core 应容忍未知的可选 provider 元数据，但不能忽略未知的强制 Node、政策或授权语义。每次无法选择 Action、无法满足 acceptance 或发现本地配置削弱政策时，都应给出资产来源、冲突字段和可行的下一步，而不是静默降级到任意默认行为。

首版可以只支持一个草案格式版本；后续版本迁移必须显式声明输入版本、迁移结果和不可逆变化。解析失败的 run 保留为可检查状态，不能因升级自动删除 evidence。

## 开放问题

- Node contract 最小可互操作字段应如何版本化，才能允许不同 host 演进而不造成错误降级？
- 任务图是使用文件、RFC 0004 runtime store 的投影，还是需要独立且可同步的存储抽象？
- 团队政策的签名、来源认证和远端分发应由 Weave、现有配置系统还是 Relay 承担？
- 如何在不把 Weave 变成 scheduler 的前提下，表达 host 可见的资源预算和并行建议？
- 对长期审计，哪些 evidence 应可提交，哪些必须只保留在本地或受控服务？
- 显式 CLI、AGENTS 路由和 IDE 入口怎样共享一次 Workflow 选择与用户确认，避免重复询问？

## 采纳检查点

进入实现前，至少需要确认：一条最小固定 Workflow 能被两个 host 理解；一个 Node 能选择两个不同 Action 并产出同类 evidence；团队政策无法被 local override 削弱；复杂度升级能保留图和证据并在需要时请求确认；以及缺少 Spec Kit、Python 或某一插件时 core 仍可解析和给出诊断。
