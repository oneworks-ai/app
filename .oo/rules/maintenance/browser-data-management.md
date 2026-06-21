# 桌面端浏览器数据管理经验

本文记录桌面端浏览器数据同步、密码管理、历史记录、下载内容和相关通用筛选组件的维护经验。它是内部协作规则，不是用户使用文档。

## 先分清功能归属

- 桌面端浏览器数据能力只在 Electron 环境展示。普通 Web / PWA 没有本机 profile、下载路径、系统认证和本机 vault 能力，不要渲染入口后再提示不可用。
- client 负责配置页、webview 菜单入口、搜索筛选和用户确认；desktop main 负责本机 profile 探测、密码解密、历史 / 下载记录持久化、文件打开和 IPC。
- `browser-data-sync/` 承载“同步数据”和“已保存的密码”UI；`browser-activity/` 承载历史记录和下载内容 UI；不要把这些能力塞进插件配置页或单个 webview 私有组件。
- 网页 tab 更多菜单只放当前网页上下文动作，例如“同步数据”“密码管理”“历史记录”“下载内容”跳转；设置页左侧才是完整管理入口。

## 密码和同步数据

- 面向用户的入口叫“同步数据”，不要叫“一键导入密码”。当前可选项可以很少，但文案要为后续密码、验证码、浏览器来源和扩展状态留空间。
- CSV 导入是通用兜底入口，应默认展示；本机浏览器来源只在探测到对应应用 / profile 后展示，Chrome 可保留明确 fallback，避免用户有 Chrome 却完全看不到入口。
- Chromium 系浏览器优先做 provider 配置复用：浏览器名、profile 根目录、macOS Keychain service、Windows user data 路径、图标和 source id。不要为 Chrome / Edge / Brave / Arc / Vivaldi / Chromium 各写一套导入流程。
- Safari / Apple Passwords / iCloud Keychain、1Password、Bitwarden 等第三方 vault 不要直接读私有 vault。可以提供 CSV / 备份文件导入或扩展启用状态同步；没有明确授权 API 时不要伪装成和 Chromium profile 一样的“同步”。
- 导入前后要复用重复账号处理逻辑。匹配维度至少包含 origin / signon realm 和相似用户名；重复时询问覆盖还是跳过，不要静默覆盖。
- passkey 只能支持使用网站提供的 WebAuthn 流程登录；不能从 Chrome / iCloud Keychain 直接同步 passkey 私钥。
- 密码管理详情页进入后使用短时前台认证窗口。不要每次点击都立刻重新认证，也不要无限期保留明文可见状态。
- 修改、删除、复制、显示密码这类账号动作使用项目内通用动作组件和 hover 文字色语义；不要退回原生 button 或局部拼一套按钮样式。

## 历史记录和下载内容

- 历史记录、下载内容是“管理页”，不是页面级 tab 分组。搜索框负责文本搜索，范围选择负责数据 scope。
- 从 launcher / 设置页进入默认全局；从某个网页 tab 入口进入时，默认选择当前项目和当前会话。
- 项目筛选必须是完整项目 select，包含“全部项目”和“当前项目”。会话筛选必须是完整会话 select，包含“全部会话”；会话 option 要展示所属项目，否则用户无法判断同名会话来源。
- 活跃 / 已归档是独立状态筛选，默认选中活跃，同时保留全部和已归档。不要把“项目 / 会话”误当成“全部 / 项目 / 会话”的三段 tab。
- 项目名在会话 option 中用 placeholder 色弱化，hover tooltip 展示工作路径；不要把工作路径直接塞进主行造成噪音。
- 下载记录打开文件、显示文件位置、历史记录打开 URL 都通过 desktop IPC 执行；client 不直接访问本机文件系统。

## 通用组件优先级

- 带搜索和右侧紧凑 action 的管理页优先复用 `action-search-toolbar/`，不要在业务页面里各自拼 AntD `Input`、按钮尺寸和图标颜色。
- 项目 / 会话范围选择优先复用 `workspace-scope-select/`。类似运行记录、审计记录、导入记录的需求应直接沿用 `WorkspaceProjectSelect` / `WorkspaceSessionSelect`，再由业务层传入当前项目、当前会话和 archived 筛选。
- 普通配置页、筛选器和设置弹窗的 Select 优先复用 `mobile-aware-select/`。不要局部覆盖 AntD 默认 `11px` padding、默认 suffix icon、blur 关闭策略或 virtual list 底部留白。
- 需要图标 + 文案的轻量动作优先复用 `inline-action-button/`。如果某个按钮样式被第二处要求复用，先抽通用组件，再接业务，不要只在当前页面修一份。
- Select option 要有稳定高度和图标槽。普通下拉默认关闭 AntD virtual scroll，避免两行 option 或带项目副标题的 option 被固定高度估算裁掉；确有大列表性能需求时再显式开启 virtual 并配套验证。

## 文件拆分和 lint

- 浏览器数据同步弹窗很容易超过文件行数限制。超过 `max-lines` 时优先按职责拆 hook、数据构造和子列表，不要添加 `eslint-disable max-lines`。
- 大型管理页拆分顺序：先抽纯展示列表 / toolbar / data type builders，再抽桌面 IPC hook。不要为了过 lint 把强相关状态拆散到难读的文件。
- main process 中 provider、parser、decrypt、dedupe、store、IPC handler 是不同层级；新增浏览器来源时优先扩展 provider 表和共享导入管线，不复制整段解密流程。

## 验证清单

- 桌面端验证入口：设置页左侧、网页 tab 更多菜单、同步数据弹窗、已保存密码、历史记录、下载内容。
- 普通 Web / PWA 验证：不展示 Electron-only 页面入口和 menu item。
- 过滤验证：launcher 进入是全局，webview 进入默认当前项目 / 当前会话，状态默认活跃，归档数据能通过已归档筛选看到。
- Select 验证：浅色 / 深色、最后一项可滚动可见、点击页面其他位置关闭、选项图标和副标题对齐、长项目路径只进 tooltip。
- 密码验证：认证窗口短时有效；查看 / 复制密码前受保护；导入重复账号会询问覆盖或跳过。
- PR 收口：UI 变更补 changelog 和截图；跑 dprint、eslint、typecheck。遇到 `max-lines` 失败时做真实拆分，不用规则豁免。
