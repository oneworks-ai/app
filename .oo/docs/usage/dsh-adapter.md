# DeepSeek Harness（DSH）适配器

`dsh` 适配器通过 DeepSeek Harness 官方 ACP 示例承载实时文本轮次。One Works 会一并托管 `@deepseek-ai/dsh-acp-demo@0.1.0-rc.6`，以及同版本的 DeepSeek 模型、sandbox、权限确认、文件系统、shell、token 计量、上下文压缩和 todo 等官方插件。

先在 One Works 进程环境中配置 API key，再在发送区选择 **DSH** 和它的原生模型：

```bash
export DEEPSEEK_API_KEY=...
```

```yaml
adapters:
  dsh:
    cli:
      source: managed
      version: 0.1.0-rc.6
    # 必须显式确认：rc.6 约束写入，但不隔离宿主读取或网络访问。
    allowUnrestrictedReadNetwork: true
    # 可选的 DeepSeek 兼容服务地址。
    baseUrl: https://api.deepseek.com
```

适配器提供当前已验证 DSH ACP 示例中的 `deepseek-v4-flash` 和 `deepseek-v4-pro`。通用 One Works Model Service 不会投影到 DSH；provider 路由仍由 DeepSeek 官方插件组合负责。

运行与安全边界：

- 每个进程使用项目私有 session cache 下隔离的 `HOME`、`DSH_HOME` 和 `DSH_AGENTS_HOME`；不会修改真实 DSH home。
- 首版接入支持 macOS 和 Linux。由于官方 npm 命令 shim 的 Windows 启动链路尚未完成端到端验证，Windows 会在安装前明确拒绝。
- `DEEPSEEK_API_KEY` 和可选的 `DEEPSEEK_BASE_URL` 只传给 DSH 子进程，不会写进生成的 Cordis 组合，也不会出现在适配器事件中。
- DSH rc.6 的 sandbox 模式会约束文件修改，但**不会**隔离宿主文件读取、进程可见性或网络访问。因此，只有显式配置 `allowUnrestrictedReadNetwork: true` 确认该上游边界后，适配器才会启动。应将 DSH 视作拥有网络访问的可信本地代码；One Works 权限提示覆盖请求的修改操作，并不覆盖每次读取或连接。
- 已验证的 ACP 边界包括新建文本会话、实时 prompt 轮次、取消、流式助手文本和权限请求。DSH 当前不会通过 ACP 发送标题、工具审计或 token usage 事件；不声明 resume/load、图片/音频 prompt、direct 一次性模式、MCP 注入或原生磁盘历史导入。实时 runtime 失效后需新建 DSH 会话。
- 选中的 rule、spec、entity 和 skill 会进入生成的 system prompt。当前 DSH ACP 示例会拒绝非空 MCP 输入，因此选中的 MCP 会显示为 skipped 诊断。

可运行 `oneworks adapter prepare dsh`，在首次会话前下载并校验固定版本的官方组合。source 与 path 覆盖方式见[适配器 CLI 安装与版本](./adapter-cli.md)。managed 模式固定为已经验证的官方 package 和版本；只有自行验证兼容二进制时才应使用 `system` 或 `path`。

上游项目：[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)。
