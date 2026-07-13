# Chrome 应用商店条目文案

## 产品信息

- 名称：`OneWorks`
- 语言：简体中文
- 分类：开发者工具
- 官网：`https://oneworks.cloud/`
- 支持：`https://github.com/oneworks-ai/app/issues`
- 隐私政策：`https://oneworks.cloud/docs/privacy`
- 可见性：公开
- 定价：免费

### 详细说明

将 OneWorks 与你明确选择的浏览器标签页连接，让你授权的 Agent 使用稳定的 tab、frame 和 document 身份查看、操作和调试这些目标。

外部浏览器提供标签页、窗口、页面语义、表单、截图、书签、历史记录、下载、阅读列表和站点数据等 typed 浏览器自动化。开发者能力包括准确标签页范围内的 Chrome debugger、网络与控制台检查、性能指标、PDF 与页面存档、会话级原始 JavaScript/CDP，以及 typed 代理控制。

控制过程始终保留明确边界：

- 只有用户主动与受信 OneWorks 来源完成双向配对后才连接；
- 每项操作都指定准确浏览器目标，不猜测“当前标签页”；
- 敏感值默认脱敏；
- 原始 JavaScript/CDP、完整 Cookie 值和敏感字段默认关闭，并随浏览器会话结束重置；配对后可读取代理状态，每次设置或清除代理都需要准确的高风险确认；
- 高风险操作需要绑定准确操作、目标和参数的逐次确认；
- 审计仅保留必要摘要，不持久化完整秘密值。

OneWorks 面向需要让 Agent 使用真实浏览器，同时保留可见控制、权限恢复、目标隔离和明确审计轨迹的开发者。

## 单一用途

在用户明确配对后，让该用户授权的 OneWorks Agent 操作和调试用户选择的浏览器目标。

权限理由、数据披露和测试步骤以同目录 [`listing.md`](./listing.md) 为审核主文案。商店正式包包含开发者所需的 `debugger` 与 `proxy` 权限；通过 Chrome 官方 `chrome.debugger` API 执行的用户指令会如实申报，不会下载或执行远程托管的扩展代码。所有可能出现在用户所选页面中的商店数据类别均按保守口径披露。中文版隐私政策为 `https://oneworks.cloud/docs/privacy`。
