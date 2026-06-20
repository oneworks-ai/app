# Utils Package

`@oneworks/utils` 承载跨 runtime 共用的基础 helper。
当前收口的是 markdown logger、log level 解析、字符串 key 转换、路径 helper、uuid、chat-message helper、cache、model selection、managed plugin package installer 和系统通知工具。

## 先看哪里

- `src/create-logger.ts`
  - 主会话 / hook runtime 共用的 markdown logger
- `src/log-level.ts`
  - `normalizeLogLevel()` / `resolveServerLogLevel()`
- `src/string-transform.ts`
  - 对象 key 转换 helper
- `src/document-path.ts`
  - workspace 共享的路径规范化 helper
- `src/model-selection.ts`
  - model service、defaultModel、adapter/model 兼容性处理
- `src/plugin-resolver.ts`
  - 统一插件实例解析、简写包名解析、manifest / hooks / config hook 入口解析
- `src/managed-plugin-package.ts`
  - `@oneworks/plugin-*` package 的 bootstrap cache、registry fallback、metadata 解析与安装 helper
- `src/cache.ts`
  - home project `caches/<task>/<session>/<key>.json` 读写 helper
- `src/system.ts`
  - `notify()`
  - 桌面通知 options schema
  - 默认图标与默认音效资产解析
- `__tests__/create-logger.spec.ts`
- `__tests__/log-level.spec.ts`
- `__tests__/managed-plugin-package.spec.ts`

## 当前边界

- 本包负责：
  - 通用 logger 实现
  - 通用 log level 解析
  - 通用对象 key transform
  - 通用路径 helper
  - 通用 cache helper
  - 通用 model selection helper
  - 通用插件解析 helper
  - managed plugin package cache / installer helper
  - 通用 system helper
- 本包不负责：
  - task 生命周期
  - 配置读取
  - adapter / hook / mcp 协议翻译

## 维护约定

- 只放可复用、无业务编排的 helper；带产品语义的逻辑留在消费包。
- 优先依赖 `@oneworks/types`，不要反向依赖 `core`、`hooks` 或 `mcp`。
- 修改 logger、log level、插件解析或 managed plugin package installer 后，至少回归 `packages/utils/__tests__` 和相关消费方测试。
