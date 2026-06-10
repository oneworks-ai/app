# Plugin Runtime RFC: Server Architecture

返回入口：[Plugin Runtime RFC](../../rfc.md)

## Server Architecture

New service directory:

```text
apps/server/src/services/plugins/
  AGENTS.md
  index.ts
  discovery.ts
  manifest.ts
  runtime.ts
  proxy.ts
```

New route:

```text
apps/server/src/routes/plugins.ts
```

Mount under:

```text
/api/plugins
```

Primary endpoints:

- `GET /api/plugins`: list enabled plugin runtime instances and contributions.
- `GET /api/plugins/:scope/client/:path*`: serve same-origin client plugin assets.
- `ALL /api/plugins/:scope/dev/:path*`: proxy `.oo/plugins.dev` client assets through the One Works server.
- `POST /api/plugins/:scope/commands/:commandId`: invoke a registered plugin command.
- `ALL /api/plugins/:scope/proxy/:apiId/:path*`: proxy HTTP to a plugin registered local API.
- `GET /api/plugins/:scope/watch`: read runtime watch status for a plugin scope.
- `POST /api/plugins/:scope/watch`: enable or disable runtime watch mode for a plugin scope.
- `DELETE /api/plugins/:scope/watch`: disable runtime watch mode for a plugin scope.

Optional websocket path:

- Existing server websocket path with `channel=plugin&scope=<scope>` for scoped plugin runtime streams.
- `channel=plugin&scope=*` subscribes to all plugin watch events and receives `plugin.changed` / `plugin.watch.updated`.

### Client Asset Route

`/api/plugins/:scope/client/:path*` serves files from the plugin client asset root:

- path is resolved relative to the plugin root or declared client root;
- `..`, absolute paths, null bytes, symlink escapes, and missing files return 404;
- `ctx.state.skipApiEnvelope = true`;
- content type is set by filename suffix or `koa-send`;
- JavaScript modules use `Content-Type: text/javascript`;
- assets set `X-Content-Type-Options: nosniff`;
- relative imports work because the entry URL and sibling modules share the same route prefix.

### Dev Asset Proxy

`/api/plugins/:scope/dev/:path*` proxies the declared `plugin.client.devServer` through the One Works server so client code stays same-origin under the existing CSP. Dev plugin imports use:

```text
/api/plugins/:scope/dev/<entry>
```

The same scoped route also proxies Vite websocket upgrades for HMR. If websocket proxying is not available in the first implementation, the required fallback is scoped reload: poll plugin manifest version or ETag, dispose only that plugin's registered contributions, and re-import the plugin entry through the same-origin dev route. The app CSP should not need to allow arbitrary `http://127.0.0.1:*` scripts.

### Scope Rules

Server keeps a registry keyed by `scope`.

Each API registration is namespaced:

```text
scope/apiId
```

Plugins cannot claim:

- Any top-level `/api/*`
- Another plugin's scope
- A built-in route key such as `sessions`, `config`, `workspace`, `agent-rooms`

Identifiers must match:

```text
^[a-z0-9][a-z0-9._-]{0,63}$
```

This applies to `scope`, `apiId`, `commandId`, `routeId`, `viewId`, slot contribution IDs, and launcher provider IDs. Registry keys are stored as tuples internally and serialized as `${scope}/${id}` only for diagnostics and URLs.

Conflicts are fatal during registry build. A plugin may expose multiple APIs under its own scope:

```text
/api/plugins/my/proxy/search
/api/plugins/my/proxy/devtools/targets
```

Client `api.fetch()` only builds URLs under the current plugin scope. It rejects absolute URLs, protocol-relative URLs, and top-level `/api/*` paths. To call another plugin, a plugin must go through an explicit future cross-plugin capability grant; the first implementation does not support cross-plugin calls.

### Server Plugin Entry

`server.entry` exports:

```ts
export async function activatePlugin(ctx: PluginServerContext): Promise<void>
```

Context:

- `scope`
- `pluginRoot`
- `workspaceFolder`
- `projectHome`
- `logger`
- `registerCommand(commandId, handler)`
- `registerApi(apiId, options)`
- `registerLocalService(serviceId, start)`
- `dispose`

`registerApi` supports two modes:

- `handler`: in-process request handler with a narrow request/response contract.
- `proxy`: local service target URL owned by the plugin runtime.

Local services are started by the One Works server so lifecycle is tied to workspace service shutdown.
