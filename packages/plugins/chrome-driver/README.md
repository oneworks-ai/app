# 外部浏览器

外部浏览器通过 Manifest V3 扩展，让 oneWorks Agent 接管用户明确配对的 Chrome。它复用 Browser Driver 的工作流和渐进式结果基础设施，但使用独立的 Chrome extension bridge、稳定的 `windowId` / `tabId` / `frameId` / `documentId` 与 typed tools；不依赖“当前标签页”猜测。任意 JavaScript/CDP、完整 Cookie 值和页面敏感字段默认关闭，用户可在设置或扩展 popup 中为当前浏览器会话显式开启。

[English](./README.en.md)

## 安装开发版扩展

```bash
pnpm --filter @oneworks/plugin-chrome-driver build:extension
```

在 `chrome://extensions` 开启开发者模式，选择“加载已解压的扩展程序”，加载 `packages/plugins/chrome-driver/dist-extension/privileged`。随后打开 oneWorks 设置中的“外部浏览器”子页面，在扩展 popup 中选择“Connect this oneWorks tab”，再回到页面点击“连接浏览器”。

正式开发者发行版声明 `debugger` 与 `proxy`，用于受控网络/控制台/DOM/性能调试、全页截图、PDF 和代理控制；书签、历史、Cookie、下载、站点数据等能力仍在 popup 中按能力组申请，并继续经过会话开关、风险确认和审计。若只需要基础语义操作，可运行 `build:extension:minimal` 并加载 `dist-extension/base`。`build:extension:e2e` 仅供隔离 profile 自动化测试，不应安装到日常浏览器。

## 构建可分发 ZIP

```bash
pnpm --filter @oneworks/plugin-chrome-driver package:extension:all
```

产物位于 `packages/plugins/chrome-driver/dist-package/`：

- `oneworks-external-browser-v<version>.zip`：正式开发者发行版，包含 `debugger` / `proxy`，用于 Chrome Web Store 上传或解压后旁加载。
- `oneworks-external-browser-v<version>-minimal.zip`：可选的最小权限备用包，不会上传 Chrome Web Store。

两个包使用同一固定扩展身份，不能在同一个 Chrome profile 中同时启用。切换到 minimal 时先停用或移除正式开发者版（切回时同理），也可以为 minimal 使用独立 profile。

Chrome 应用商店的版本化截图、宣传图和审核文案维护在 [`store-assets`](./store-assets/)；商店隐私字段使用公开的 [oneWorks 隐私政策](https://oneworks.cloud/docs/privacy)。

ZIP 根目录直接包含 `manifest.json`。构建会把 workspace semver 映射为 Chrome 可比较的四段整数版本，并用 `version_name` 保留原始版本；例如 `0.1.0-beta.5` 映射为 `0.1.0.20005`。同一源码和版本重复构建会得到相同 SHA-256。`package:extension:all` 会同时校验固定扩展身份、图标、运行时入口、权限 flavor 和 E2E 泄漏。

`.github/workflows/chrome-extension-ci.yml` 在相关 PR / main 变更时构建并保留开发者版、minimal 版和 `SHA256SUMS`。main 上首次创建 `pkg/oneworks-plugin-chrome-driver/v*` tag 时，Release Tags 会显式触发 `.github/workflows/chrome-extension-release.yml`：创建带 provenance attestation 的 GitHub Release，并在通过 `chrome-web-store` environment 后，使用短期 WIF service-account token 自动上传完整开发者版和提交审核。重跑已有 tag 默认只恢复 GitHub Release，避免重复提交商店；商店失败可从同一 tag 手动 dispatch 并设置 `publish_store=true` 重试。

## 能力矩阵

| 模块           | 查询                                                                                                         | 修改 / 控制                                                                                                        |
| -------------- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| 浏览器目标     | 能力与权限、窗口、标签页、分组、活动页、最近关闭、同步设备、显示器、调试目标                                 | 创建、关闭、切换、移动、固定、静音、刷新、前进后退、缩放、分组                                                     |
| 用户数据       | 书签树/搜索、历史/访问记录、下载、阅读列表、扩展管理信息                                                     | 书签增删改移、历史清理、下载控制与记录/文件清理、阅读列表维护；需原生手势的扩展/下载操作会明确报告而非静默执行     |
| 页面与 frame   | 页面元数据、语义快照、稳定 ref、frame/document 清单、等待条件；可按会话开启敏感字段值                        | 点击、输入、选择、按键、滚动、可见区域截图、打印、MHTML、PDF；可按会话开启密码等敏感字段输入                       |
| 调试与高级访问 | 网络/控制台/异常事件、DOM 摘要、性能指标、attach 状态；高权限版本可按会话开启广泛的 `Runtime.evaluate` / CDP | 显式 attach/detach、受限截图与 PDF；Raw 是浏览器会话级能力，调用前检查 `tab_id` 与来源以避免误导航，并逐次 R4 确认 |
| 隐私与网络     | 默认返回 cookie 脱敏元数据；可按会话为精确 URL 开启完整值；站点设置、清理预览、代理/隐私设置                 | 精确 cookie/站点设置、限定来源的浏览数据清理、typed proxy/privacy 配置                                             |
| Workflow       | 运行、步骤、审计与渐进式结果查询                                                                             | 顺序步骤、条件、等待、超时、节点不存在退出、checkpoint/确认、暂停与恢复、不同 target 并发                          |

同一 target 的命令在 bridge 中串行；不同 target 可并发。短 workflow 直接返回，长 workflow 返回 `run_id`，可按 `step_id` 查询或从 checkpoint 恢复。

语义修改必须携带 snapshot / frame 发现返回的 `document_id`。导航后旧 ref 会失效，不会把点击或输入落到替换后的文档。完整 workflow 共享规范化 tab 锁，同一 tab 的两条 workflow 不会交错，不同 tab 仍可并发。截图 / PDF 使用有界 50 MiB 分块通道，不占用 request/ack JSON 上限。

## oneWorks Web bridge

发布 manifest 固定扩展身份。bridge 只在扩展 ID、服务端维护的 loopback / 配置 origin 白名单、页面 nonce 与双向协议版本全部匹配后发放一次性 ticket；扩展请求还必须带精确的 `chrome-extension://` Origin。配对后可发现该标签页的 frame；跨域 frame 仍需对应 host permission，并保持独立 `frameId` / `documentId`。导航、刷新、断连、缺权限或版本不匹配均会进入可恢复状态，不会依据标题识别页面，也不会无边界访问敏感 iframe。

## 风险与明确边界

- R0：能力与审计发现；R1：元数据/语义读取；R2：可逆的目标级控制；R3：敏感或破坏性的限定操作；R4：浏览器级高权限修改。
- R3/R4 由 bridge 按操作服务端定级。确认绑定精确操作、参数、target、连接和浏览器会话，五分钟后过期，换会话即作废；关闭 tab/window 与完整页面归档/PDF 均为 R3。
- 默认结果经过扩展与 bridge 双重脱敏：URL 去掉 userinfo 与敏感查询键，敏感表单值和 console 文本会遮蔽，内联 PAC 源码会移除，cookie 元数据查询不返回 value。
- “高级会话访问”提供 Raw CDP/JavaScript、完整 Cookie 值、页面敏感字段开关；策略只保存在 `chrome.storage.session`，浏览器会话结束即复位。Raw 是 Cookie/敏感字段能力的超集，也是浏览器会话级权限；`tab_id` 与来源检查用于发现误导航，不构成安全隔离。Raw 全局独占执行，并由 bridge 对每次调用执行 R4 确认；待确认项显示脱敏预览，持久审计只保存分类与 hash。明显的宿主文件路径/文件系统逃逸方法仍被硬阻断。
- 点击、输入、选择、按键和滚动使用共享 `@oneworks/cursor` 28px 标准光标；首次操作平滑出现，并在同一连接 session 的连续操作间保留位置，只在断开或忘记连接时淡出清理。执行期间目标 Chrome tab 的 favicon 临时显示同一 Agent 光标，结束或取消后恢复页面最新 favicon。状态按显式 tab/document 隔离。
- 需要 Chrome 原生用户手势的操作（如打开下载文件、启停其他扩展）返回 `USER_GESTURE_REQUIRED`；Agent 确认不会被伪装成 Chrome user activation。
- Chrome 没有向扩展开放已保存密码库的读取/导出 API；高级访问覆盖当前网页中的密码字段、DOM 和存储，不代表能读取 Chrome Password Manager。
- 仍不支持直接读取浏览器密码库、宿主文件路径/文件系统原语、宿主进程代码执行、Raw 之外的跨域策略绕过、静默安装/授权、桌面捕获 picker/stream 代操作、ChromeOS 专用打印 API 或无限响应正文抓取。
