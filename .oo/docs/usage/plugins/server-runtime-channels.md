# 插件 Runtime 通信

Server 侧能力：

- `ctx.workspaceFolder`: 当前 workspace 路径。
- `ctx.projectHome`: 当前项目运行态目录。
- `ctx.pluginRoot`: 当前 plugin 根目录。
- `ctx.runtime.endpoint`: 当前 runtime endpoint，包含 `role`、`serverBaseUrl`、`workspaceId`、`workspaceFolder`、`startedAt` 等识别信息。
- `ctx.runtime.role`: 当前入口正在 `manager` 还是 `workspace` runtime 中运行。
- `ctx.runtime.registerChannel(channelId, handler)`: 注册当前 plugin scope 下的 runtime 通信通道。
- `ctx.runtime.invokeChannel(channelId, invocation)`: 调用同 scope 下的 runtime 通道；可通过 `invocation.target` 指向另一个 runtime endpoint。
- `ctx.registerCommand(commandId, handler)`: 注册 scoped command，前端可通过 `ctx.commands.execute` 或 `/api/plugins/<scope>/commands/<commandId>` 调用。
- `ctx.registerApi(apiId, options)`: 注册 scoped API，路径固定在 `/api/plugins/<scope>/proxy/<apiId>/*`。
- `ctx.registerLocalService(serviceId, start)`: 注册跟随 plugin 生命周期的本地服务。
- `ctx.dispose(callback)`: plugin reload 或 server 关闭时清理资源。

management server 会通过 `/api/plugins/runtime/endpoints` 暴露当前 manager endpoint 和 launcher 已知的 workspace endpoints。workspace client 会从 launcher 连接缓存里读取当前 workspace 对应的 management server 地址；这个缓存不区分本地 launcher 和 Relay 连接来源。

runtime channel 用于同一个插件在 manager 和 workspace runtime 之间传递结构化消息，不替代 scoped HTTP API。manager 调 workspace 时可以使用 `target.workspaceId`，由 manager 按 launcher 记录解析到真实 workspace server；跨 workspace 或 workspace 主动调远端时仍应显式带 `target.serverBaseUrl`，避免因为一台设备上有多个 workspace server 而误发：

```ts
export function activatePlugin(ctx) {
  ctx.runtime.registerChannel('ping-runtime', request => ({
    from: ctx.runtime.role,
    source: request.source.role,
    payload: request.payload
  }))

  if (ctx.runtime.role === 'workspace') {
    void ctx.runtime.invokeChannel('ping-runtime', {
      payload: { ok: true },
      target: {
        role: 'manager',
        serverBaseUrl: 'http://127.0.0.1:5203'
      }
    })
  }
}
```

channel handler 收到 `{ channelId, payload, source, target }`；返回值会作为调用方的 Promise 结果。目标 runtime 没有注册对应 channel 时会返回明确错误。
