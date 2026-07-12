# @oneworks/plugin-cua-driver

这是 OneWorks 对 [Cua Driver](https://github.com/trycua/cua/tree/main/libs/cua-driver) 的薄插件封装。Cua Driver 是 macOS 后台 computer-use driver；OneWorks 继续负责模型、会话、agent loop、取消和日志，插件通过 MCP 资产把原生 GUI 工具注入会话，并在 MCP 进程启动时完成运行环境准备。

插件不会引入 Cua 自己的 agent loop。

## 提供的能力

- `cua-driver` skill：说明如何观察、操作并验证真实 macOS App
- scoped Cua Driver MCP 资产：把原生 GUI 工具直接投影到当前 adapter
- `cua-driver` / `ow-cua-driver` package bin：按需安装或转发到真实 Cua Driver CLI
- 插件内置、经过收窄的安装与卸载脚本：只管理 `CuaDriver.app` 和插件创建的 CLI 链接
- `manager` / `workspace` server runtime：提供状态、路径、显式环境准备和 launcher 搜索
- 自动展示与操作同步的 Agent 虚拟指针，不移动用户的物理鼠标；workflow 默认从主屏中心出发，Agent 也可配置逻辑坐标起点
- 过程化 `execute_workflow`：一次提交可预测的串行步骤，在运行时自动刷新窗口状态、解析语义目标、等待并验证；只在 checkpoint、失败或完成时返回
- `resume_workflow` 与 `get_workflow_step_results`：断点恢复，以及通过 `run_id + step_id` 渐进查询步骤详情
- 通过通用 `toolUsePresentations` 贡献为工具调用提供本地化标题、操作图标、摘要目标和结构化展开内容

## 安装与启用

```bash
pnpm add -D @oneworks/plugin-cua-driver
```

在 `.oo.config.json` 或 `.oo.config.yaml` 中启用：

```json
{
  "plugins": [
    {
      "id": "cua-driver",
      "scope": "cua"
    }
  ]
}
```

设置 `scope` 后，skill 名称是 `cua/cua-driver`。不设置 scope 时使用 `cua-driver`。

macOS 非 CI 环境安装 package 时，会 best-effort 安装官方签名的 `CuaDriver.app`。如需跳过：

```bash
ONEWORKS_CUA_DRIVER_SKIP_POSTINSTALL=1 pnpm install
```

正常使用无需手动准备环境。agent 只需调用 `cua-driver` skill；插件会在 MCP 工具可用前自动安装缺失组件、准备后台服务、检查权限，并启用 Agent 虚拟指针。默认会按 OneWorks 会话稳定分配不同颜色；用户可在插件详情的「配置」页切换为固定默认色，agent 也可为当前会话传入任意合法十六进制颜色。每个 workflow 未传 `cursor_start` 时会从主屏中心开始；Agent 可传入主屏逻辑坐标，或在低层恢复流程中调用 `set_session_cursor_start` 配置下一次指针动作的起点。CUA 负责选择颜色和决定何时应用光标；共享的 `@oneworks/cursor` 包负责生成带圆角和对比边框的安全 SVG。`ensure` 仅保留为诊断或修复命令：

```bash
ow-cua-driver ensure
```

`ensure` 会在缺失时安装 App、验证运行环境并请求检查辅助功能与屏幕录制权限。后台服务未就绪时会自动恢复；恢复失败则明确报错，不会返回假 ready。TCC 授权必须由用户在 macOS「系统设置 → 隐私与安全性」中确认；插件会指出缺失的具体权限，授权后直接重试原任务即可。

## 执行环境用法

启用后，用户只需描述目标。OneWorks 会把插件 MCP 资产自动投影到会话。多个可预测动作应优先通过一次 `execute_workflow` 调用提交；只有探索未知界面或故障恢复时才逐次调用 `launch_app`、`get_window_state`、`click` 等低层工具。不应把 `ensure`、后台服务、路径解析、权限检查或指针配置写进用户任务。wrapper 会在 MCP 长连接建立前完成一次受控预检。后台 AX 操作不会移动物理鼠标，用户看到的是插件自动维护的 Agent 虚拟指针。

workflow 结果按大小自适应：不超过三个且较小的步骤直接内联；更长的执行只返回步骤 ID，通过 `get_workflow_step_results` 按需批量读取。运行状态保存在当前 MCP 会话中，不会把完整 trace 默认注入 agent 上下文。

workflow runtime 会在每个 MCP 会话内过程化地固定 AX 语义观察模式，避免上游截图/SOM 解析差异影响节点定位；该内部配置能力不会暴露给 agent。需要像素证据时仍单独调用 `screenshot`。由于上游 Agent 指针样式是 daemon 全局状态，插件会跨进程串行执行“应用当前会话样式 + 设置起点 + 点击动作”，避免多个并行会话互相串色或串起点；非指针操作不受这把锁影响。

演示、录屏或回归证据由外层编排器负责系统显示录制，被测会话只执行和验证原生 App 操作。这样才能同时证明虚拟 Agent 指针实时可见、用户前台应用未被抢占。上游 trajectory、`cursor.jsonl` 和逐步截图只保留为诊断材料，不再把截图拼接视频当作动态指针证据。用户明确只要最终静态图时，被测会话仍可通过 `screenshot_out_file` 保存独立窗口截图。

## Plugin runtime

`plugin.json` 声明 `manager` 和 `workspace` 两个 server role：

- `workspace`：为当前项目提供 `status`、`driver-path`、`ensure` 和 scoped `status` API
- `manager`：提供同一组设备级命令，并向桌面 launcher 暴露状态检查与环境准备入口

Scoped commands：

- `status`：只读检查安装路径与后台服务状态，不触发安装
- `driver-path`：只读返回当前可发现的 driver 路径
- `ensure`：使用插件托管默认值显式准备运行环境
- `launcher.search`：提供 launcher 搜索结果与执行动作

Scoped API：

```text
GET /api/plugins/<scope>/proxy/status
```

API 在插件详情中包含标题、说明、输入、输出和 header schema 元数据。

## 安全边界

- postinstall 只在 macOS、非 CI、App 缺失时 best-effort 执行
- 安装脚本不会修改全局 Codex / Claude / OpenCode skill，也不会注册 MCP
- `ow-cua-driver uninstall` 不会删除用户配置、录制、MCP 配置或 TCC 授权
- 可以用 `CUA_DRIVER_VERSION` 固定要安装的上游 release；默认固定到插件验证过的版本

## 验证

```bash
pnpm -C packages/plugins/cua-driver typecheck
pnpm -C packages/plugins/cua-driver build
node packages/plugins/cua-driver/bin/cua-driver.cjs wrapper-help
```
