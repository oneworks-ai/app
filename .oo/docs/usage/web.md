# Web UI 与 Terminal 视图

## Web UI 入口

- 执行 `npx oneworks web` 后访问终端输出的 `/ui/` 地址，默认是 `http://127.0.0.1:8787/ui/`。
- Web UI 默认要求登录；账号配置见 [启动服务](./runtime.md) 中的 `webAuth` 示例。
- 如果前端需要独立部署到静态站点或安装成 PWA，继续看 [PWA 与独立部署](./pwa.md)。
- 普通“新建会话”默认创建普通 session，不会立即创建 Agent Room；会话详情页路径是 `/ui/session/<sessionId>`。
- 只有在这个 host session 内通过 `oneworks agent start` / runtime protocol 启动 child runtime sessions 后，server 才会基于 runtime store metadata/events 自动创建或发现 Agent Room，并默认把前端切到 `/ui/rooms/<roomId>` 的聊天室模式；右上角的「会话模式 / 聊天室模式」按钮可以在主会话视图和 room 视图之间切换。
- 配置页路径是 `/ui/config`；通过 `tab` 和 `source` query 控制当前 section 与 `global` / `project` / `user` 来源，例如 `/ui/config?tab=general&source=global`。
- 如果配置页进入了二级详情页，当前详情路径也会写入 `detail` query；复制完整 URL 后，可以直接回到对应的配置子页面。
- `view` query 目前支持 `history`、`timeline`、`terminal`、`settings`。
- 终端视图入口是 `/ui/session/<sessionId>?view=terminal`。
- 聊天页 sender 下方会固定显示一个 status bar：左侧承载当前 session 的 workspace / git 操作；新建会话时这里会继续展示，并允许先决定是否创建 worktree、使用哪个 worktree 环境，以及要切到哪个分支。
- 新建会话默认使用当前共享工作区，不自动创建托管 worktree。需要默认以 worktree 启动时，可以在解析后的 workspace 根目录配置文件（默认是 `.oo.config.json` / `.oo.config.yaml`，也支持 `./infra/` 或显式 `__ONEWORKS_PROJECT_CONFIG_DIR__`）里设置 `conversation.createSessionWorktree: true`；Web UI 新建会话时会按这个项目配置初始化，也可以在发送第一条消息前临时切换。
- 分支面板支持 `树状 / 平铺` 两种展示模式；两种视图共用同一套搜索和切换逻辑。
- 如果新建会话启用了 worktree，但没有显式指定分支，server 会默认从源 worktree 当前分支派生一个新的 session worktree 分支；只有源目录本身是 detached HEAD 时，才会退回 detached 模式。
- session managed worktree 会落在 `.oo/worktrees/sessions/<sessionId>/<repo-name>`；最后一级目录始终跟随当前 git 根目录名，方便和真实仓库目录保持一致。
- 如果当前 session 分支还没有对应的远端分支，`同步` 会优先尝试同名远端分支；如果远端还没有这条分支，则会回退到 worktree 记录的基线分支继续同步。
- 以 worktree 启动时，新建会话会展示 worktree 创建进度，以及当前环境 `create` 脚本的执行状态；worktree 创建或所选环境脚本异常时，会话创建会中止并清理已经创建的托管 worktree。
- worktree 环境脚本通过配置页的“环境”面板维护；项目环境写入 `.oo/env/<environment-id>/`，本地环境写入 `.oo/env.local/<environment-id>/`。脚本内容使用 Monaco 编辑器编辑，详情页里的名称与脚本修改会自动写回本地文件。项目默认环境由 `conversation.worktreeEnvironment` 指定，也可以在新建会话时通过 sender 下方的环境下拉临时覆盖；本地环境在配置值里使用 `<environment-id>.local` 引用。
- 新会话页支持读取 `conversation.startupPresets` 和 `conversation.builtinActions`：前者适合配置“启动环境预设”，后者适合配置“发布 / 修复流水线 / 补回归测试”这类动作模板。点击列表项后，Web UI 会同步切换目标模式、模型、推理强度、worktree 设置，并把预置提示词和关联文件 / 规则 / 技能写入 sender。
- 聊天页右上角的运行指令写入项目配置 `conversation.runCommands`。每条指令包含 `name`、`icon`、`script`、`env` 和 `isFavorite`，执行时会在下方面板创建或复用一个 pin 住的终端任务 tab；“上次运行的是哪条”仍然是当前浏览器里的本机偏好。
- 下方面板的 tab header 会按 tab 类型显示右侧 action。当前打开 `.sh`、`.bash`、`.zsh` 文件时，文件 tab 右侧会出现「运行脚本」按钮，点击后通过同一套运行指令通道在当前 workspace 下执行 `bash '<path>'`，并创建或复用对应任务 tab。
- 左侧会话列表默认不在 session card 展示消息摘要；如果希望在卡片里显示最近消息预览，可以在配置页 `Conversation -> Defaults` 打开 `conversation.showSessionCardMessage`。
- 聊天消息里的链接行为可通过配置页 `General -> Message Links` 维护，对应配置键是 `messageLinks`：`externalLinkTarget` 控制网页链接在新标签或当前标签打开，`workspaceFileTarget` 控制工作区文件链接打开到下方文件 tab、外部应用或使用浏览器默认行为，`workspaceFileOpener` 控制首选打开工具，`imageLinkMode` 控制标准图片链接是否直接渲染为可全屏预览的图片，`plainWorkspacePathMode` 控制裸工作区文件路径是否自动变成链接。外部应用由服务端嗅探本机支持的 VS Code、Cursor、Windsurf、Zed、JetBrains 工具与 macOS TextEdit；配置页的打开工具下拉只展示当前服务端检测到的可用工具，选择 `auto` 时会使用第一个可用工具，并尽量带上工作区目录、文件路径与行列号。图片链接识别只看 URL / 路径后缀以及 `data:image`、`blob:` 源，不额外发起跨域探测请求。

示例：

```json
{
  "messageLinks": {
    "externalLinkTarget": "newTab",
    "workspaceFileTarget": "externalIde",
    "workspaceFileOpener": "auto",
    "imageLinkMode": "inlinePreview",
    "plainWorkspacePathMode": "link"
  },
  "conversation": {
    "createSessionWorktree": true,
    "showSessionCardMessage": true,
    "worktreeEnvironment": "default",
    "startupPresets": [
      {
        "title": "标准开发 Agent",
        "mode": "agent",
        "target": "std/dev-planner",
        "adapter": "codex",
        "effort": "high",
        "worktree": {
          "create": true,
          "environment": "default"
        },
        "prompt": "请先阅读仓库规则和当前上下文，拆解方案后开始推进实现。",
        "rules": [
          ".oo/rules/ARCHITECTURE.md"
        ],
        "skills": [
          "std/standard-dev-flow"
        ]
      }
    ],
    "builtinActions": [
      {
        "title": "发布",
        "icon": "rocket_launch",
        "prompt": "请梳理本次发布范围，执行发布前检查，并输出发布步骤与变更摘要。",
        "rules": [
          ".oo/rules/RELEASE.md"
        ]
      }
    ],
    "runCommands": [
      {
        "id": "dev-server",
        "name": "开发服务",
        "icon": "terminal",
        "script": "pnpm dev",
        "env": [
          {
            "key": "NODE_ENV",
            "value": "development"
          }
        ],
        "isFavorite": true
      }
    ]
  }
}
```

## 工作区抽屉与文件引用

- 会话页右侧工作区抽屉按当前 session workspace 展示项目目录树和 Git 改动文件。
- 目录树支持展开、折叠、定位当前打开文件，以及通过 `Shift` 连续多选文件或文件夹。
- 目录树节点支持右键菜单；选择 `引用到输入框` 会把当前节点或已选节点追加到 sender 的文件引用列表。
- sender `更多` 里的文件引用弹窗复用同一套项目目录树，也支持选择文件夹。
- 文件引用只记录 workspace-relative 路径；真正发送时仍由各 adapter 按自己的上下文文件语义处理。

## 配置页交互

- 简单字段仍然在 section 页面内直接编辑。
- 桌面端配置页左侧 section 导航支持搜索和折叠；收起左侧导航后，内容区标题左侧会出现一个展开按钮，方便在不离开当前配置页的情况下重新打开导航。
- 复杂集合字段会拆成“一级摘要页 + 二级详情页”的模式：数组型字段在一级页负责新增、删除和排序；对象型字段会展示固定条目和快捷开关，进入二级页后再做细粒度配置。
- 二级详情页会在 section 标题右侧展示字段路径面包屑，并提供返回入口；返回时会尽量恢复上一级列表的滚动位置。
- “外观”页会把界面主题色写入当前选中的配置来源；主题模式、sender 输入区顶栏默认展开/折叠、会话列表搜索栏展示阈值，以及新建会话时是否显示公告、推荐操作列表等 Web UI 本地偏好仍写入当前浏览器本地存储。
- adapter 配置页现在会把字段拆到 `基础配置 / 模型配置 / 高阶配置 / 账号` 这些前端分组里；`defaultAccount` 位于基础配置，`账号` 作为独立入口展示。
- `adapters.<adapter>.accounts` 现在额外提供一个账号管理子页：可以直接触发 adapter 的接入动作、查看账号来源和额度摘要，并进入账号三级详情页编辑 `title / description / authFile`。
- 具体的 adapter 配置与多账号说明见 [Adapter 配置与多账号](./adapters.md)。
- 当前 `general.recommendedModels`、`general.notifications.events`、`general.skillRegistries`、`modelServices`、`channels`、`adapters`、`plugins.plugins`、`plugins.marketplaces` 和 `mcp.mcpServers` 已经切到这套模式。

### 继承与覆盖规则

- `global` / `project` / `user` 配置页编辑的是当前 source 文件里的原始配置，不是 `extends` 展开后的结果。
- API 与 CLI 中的 `merged` 展示的是最终生效配置；它用于查看效果，不承担 source 文件编辑语义。
- 如果某个值只来自 `extends`，界面会先按“继承值”展示；是否允许直接开始编辑，取决于字段类型和集合合并语义。

| 类别                                | 代表字段                                                              | 继承态展示                       | 开始编辑方式                                | 写回粒度           |
| ----------------------------------- | --------------------------------------------------------------------- | -------------------------------- | ------------------------------------------- | ------------------ |
| inline override                     | `string` / `multiline` / `number` / `boolean` / `select` / `shortcut` | 直接把 inherited 值显示在控件里  | 直接修改                                    | 单个 field         |
| 显式 whole-field override           | `string[]` / `json` / `record`                                        | 先只读展示 inherited 值          | 点 `Override in current config` 后再修改    | 整个 field         |
| 显式 item override                  | `record` / `recordMap` 型 detail collection                           | 列表里标 `Inherited`，详情页只读 | 进入详情页后点 `Override in current config` | 单个 item          |
| 允许 item override 的 list          | 有稳定 merge key 的 list detail collection                            | 同上                             | 同上                                        | 单个 item          |
| 不允许 single-item override 的 list | append-only list detail collection                                    | 列表里标 `Inherited`，详情页只读 | 不能直接覆盖继承条目，只能新增本地项        | 只能 append 本地项 |

- 当前按 `id + scope` 识别稳定 merge key 的列表是 `plugins.plugins`。
- 当前按追加语义处理、不能单条覆盖继承项的列表是 `general.recommendedModels`。
- 当前按对象条目做显式 item override 的字段包括：`modelServices`、`channels`、`adapters`、`plugins.marketplaces`、`general.skillRegistries`、`mcp.mcpServers`、`general.notifications.events`。
- 简单标量字段如果来自 `extends`，修改后会在当前 source 文件里落一个本地 override，不会回写到上游继承文件。

## Worktree 环境脚本

每个环境目录可以包含这些脚本：

- `create.sh`、`create.macos.sh`、`create.linux.sh`、`create.windows.ps1`：托管 worktree 创建完成后执行。
- `start.sh`、`start.macos.sh`、`start.linux.sh`、`start.windows.ps1`：会话 adapter 进程启动前执行。
- `destroy.sh`、`destroy.macos.sh`、`destroy.linux.sh`、`destroy.windows.ps1`：托管 worktree 删除前执行；兼容旧拼写 `destory*.sh`。

本仓库内置项目环境 `default`。新建托管 worktree 时，它会先拉取默认远端；如果当前 session 分支有同名远端分支，则同步该分支，否则回退同步创建 worktree 时记录的基线分支。

Windows 下 `*.ps1` 会通过 PowerShell 执行；如果你手动维护文件，也兼容同名 `*.windows.cmd` 和 `*.windows.bat`。通用脚本在 Windows 下支持 `create.ps1` / `start.ps1` / `destroy.ps1`、`.cmd` 和 `.bat` 变体；`.sh` 基础脚本不会在 Windows 上作为默认脚本执行，避免强依赖 `sh`。

配置页右上角选择“项目”时，新建环境会写入 `.oo/env/<environment-id>/`，可随项目提交；选择“本地”时，新建环境会写入 `.oo/env.local/<environment-id>/`，并维护根目录 `.gitignore` 中的 `.oo/env.local/`，作为当前用户自己的配置。旧版 `.oo/env/<environment-id>.local/` 仍会按本地环境读取，但新建和保存都会使用 `.oo/env.local/`。

执行顺序是通用脚本先执行，再执行当前系统对应脚本。脚本工作目录是当前 session workspace，并会收到这些环境变量：

- `ONEWORKS_WORKTREE_ENV`：环境名称。
- `ONEWORKS_WORKTREE_OPERATION`：`create`、`start` 或 `destroy`。
- `ONEWORKS_WORKTREE_PATH`：当前 worktree 路径。
- `ONEWORKS_SESSION_ID`：当前 session ID。
- `ONEWORKS_WORKTREE_SOURCE_PATH`：创建 worktree 时的来源 workspace。
- `ONEWORKS_REPOSITORY_ROOT`、`ONEWORKS_WORKTREE_BASE_REF`、`ONEWORKS_WORKTREE_FORCE`：仓库、基线和强制删除上下文。

## Terminal 视图是什么

- `terminal` 视图会在当前 workspace 上下文里打开一个交互式 shell。
- 同一个会话页可以通过 terminal 面板右上角 `+` 创建多个 terminal pane；多个 pane 会在同一个 dock 内自动拼接展示，每个 pane 对应一条独立 shell runtime。
- `+` 和右侧下拉入口作为一个创建按钮组展示，下拉入口可以选择新 terminal 使用的 shell 类型。
- terminal 输入焦点内支持清屏快捷键：macOS / iPadOS 使用 `Cmd+K`，Windows / Linux 使用 `Ctrl+K`，触发后只清空前端输出，不向 shell 发送控制字符。
- terminal 输入焦点内会把 macOS / iPadOS 的 `Option` 作为 terminal Meta 键处理，支持 `Option+b/f/d/delete` 等 shell 快捷键；普通 shell 输入行里按词移动可使用 `Option+←/→`，前端会按当前渲染行计算词边界并发送普通左右箭头，避免在 vi keymap 下触发 `ESC f` 的 find-char 行为；进入 vim / tmux 等 alternate screen 后会保留标准 `Alt+←/→` 箭头序列，Windows / Linux 支持 `Alt+←/→` 和 `Ctrl+←/→`。
- terminal 面板操作栏支持全屏 / 退出全屏；全屏时 terminal dock 覆盖当前会话内容区域，并隐藏上方聊天内容。
- 多个 terminal pane 存在时，操作栏支持隐藏 / 显示右侧管理列表；列表隐藏时，切换按钮右下角会显示当前 pane 数量。
- 右侧管理列表支持双击标题进入编辑、hover 后关闭以及通过插入指示线拖拽调整顺序；列表标题固定保存在 pane 配置中，shell 类型在标题 hover tooltip 中展示。
- 前端使用 `xterm.js` 渲染；后端走独立 terminal websocket channel，而不是复用 chat `WSEvent`。
- 终端 pane 的标题、shell 类型和排序保存在当前浏览器的 localStorage；终端 scrollback 和 socket 生命周期保存在 server runtime 内存里，不写入 chat `messages` 持久化表。
- 重新打开同一会话页时，页面会按已保存的 pane 列表尝试重连已有 terminal runtime；如果会话已删除或 sessionId 不存在，会返回 fatal error 并关闭 socket。

## 使用前提

- `__ONEWORKS_PROJECT_WORKSPACE_FOLDER__` 要指向你真正想操作的项目目录；如果没显式设置，server 启动时会从当前目录向上探测 workspace 根目录。
- server 进程需要能在该 workspace 下启动 shell；如果运行环境缺少 PTY 能力，交互体验会退化。
- terminal 主题跟随当前 Web UI 的浅色 / 深色 token，不需要额外配置第二套主题参数。

## 排查顺序

- 页面打不开 terminal 时，先确认 `sessionId` 对应的会话在 `/api/sessions` 里真实存在。
- 页面能打开但不能交互时，先看 browser focus 和 terminal websocket，再看 server 端 shell / PTY 是否正常启动。
- 只看到背景或颜色异常时，先检查 `.chat-terminal-view__surface`、`.xterm-viewport` 和 terminal renderer 的实际背景，而不是只看外层容器。
