# Config Package

`@oneworks/config` 承载通用配置读写、`defineConfig()`、默认 system prompt 策略与默认内建 MCP 解析。
业务 schema 类型仍由 `@oneworks/types` 维护。

## 先看哪里

- 涉及 global / project / user 合并、effective config、关闭全局开关或 source 写回边界时，先看 `../../.oo/rules/CONFIG.md`
- `src/load.ts`
  - `buildConfigJsonVariables()`
  - `loadConfig()`
  - `loadAdapterConfig()`
  - `resetConfigCache()`
- `src/plugin-config.ts`
  - 插件 config hook 加载与运行时 config patch 合并
- `src/update.ts`
  - `updateConfigFile()`
- `src/define.ts`
  - `defineConfig()`
- `src/system-prompt.ts`
  - 默认 system prompt 开关解析与提示词合并
- `src/default-oneworks-mcp.ts`
  - 默认内建 MCP 开关与 package 解析
- `__tests__/load.spec.ts`
  - 配置缓存与 dev config 行为回归

## 当前边界

- 本包负责：
  - 配置文件查找顺序
  - global/project/user config 文件写回
  - `${ENV_VAR}` 变量替换
  - workspace 级缓存与 cache reset
  - `defineConfig()` typed helper
  - global/project/user/extend config merge 策略
  - 插件 config hook 返回值到最终 user 层的运行时合并
  - 默认 system prompt 开关解析与合并策略
  - 默认内建 MCP 开关与 package 解析
- 本包不负责：
  - `Config` 业务 schema 定义本身
  - adapter / hook / server 的消费语义

## 维护约定

- `loadConfig()` 返回共享 `Config`；不要再给 loader 加消费方专用泛型。
- `defineConfig()` / system prompt helper 只消费共享 `Config` 类型，不在这里重新定义 schema。
- merge 逻辑集中在 config 包内维护；`updateConfigFile()` 只处理配置文件持久化和受控字段更新。
- 新增环境变量替换、默认 system prompt 规则或缓存规则时，先补 `__tests__/*`。
