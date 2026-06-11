# Kimi Verification

## 真实 CLI Smoke

不要只跑单测。默认 adapter stream runtime 已经走 `kimi --wire`，至少覆盖一次本地真实 CLI：

```bash
PATH="$HOME/.local/bin:$PATH" \
npx ow run -A kimi --print hi
```

如果要走真实 model service，使用仓库已有私有 [.oo.dev.config.json](../../../../../.oo.dev.config.json)，不要把 key 写进文档或提交：

```bash
PATH="$HOME/.local/bin:$PATH" \
__ONEWORKS_PROJECT_PRIMARY_WORKSPACE_FOLDER=/path/to/real/workspace \
npx ow run \
  -A kimi \
  --model kimi,kimi-k2.5 \
  --no-default-oneworks-mcp-server \
  --print hi
```

当前已验证的真实环境：

- `uv 0.11.6`
- Kimi CLI `1.36.0`
- `npx ow run -A kimi --model kimi,kimi-k2.5 --print hi` 能通过真实 API 返回 Kimi 响应；这里的 `--print` 是 One Works CLI 输出模式，adapter 内部仍应启动 Kimi Wire。
- `--output-format stream-json --input-format stream-json` 已覆盖真实多轮交互：第一轮 Shell approval 回写 `allow_once`，`tool_use.input.command` 从 Wire approval display 反填，第二轮继续 `message`，最后 `stop` 控制事件正常退出。
- 单测覆盖了非 Shell display 反填：file `diff` display 会合并进已有 Wire arguments，todo display 在 arguments 为空时会生成结构化 `items`。
- 单测覆盖了 resume provenance：显式不匹配的旧 share 不迁移，多个没有 provenance 的旧候选不按 mtime 猜。

## 本地检查

```bash
pnpm exec dprint check
pnpm exec eslint .
pnpm typecheck
pnpm exec vitest run \
  packages/adapters/kimi/__tests__/runtime-config.spec.ts \
  packages/adapters/kimi/__tests__/native-hooks.spec.ts \
  packages/adapters/kimi/__tests__/session-wire.spec.ts \
  packages/workspace-assets/__tests__/adapter-asset-plan.spec.ts \
  packages/task/__tests__/run.spec.ts \
  packages/hooks/__tests__/runtime.spec.ts \
  apps/server/__tests__/services/session-permission.spec.ts
```

## 官方资料

- [Kimi Code CLI Docs](https://moonshotai.github.io/kimi-cli/en/)
- [kimi Command](https://moonshotai.github.io/kimi-cli/en/reference/kimi-command.html)
- [Print 模式](https://moonshotai.github.io/kimi-cli/zh/customization/print-mode.html)
- [Config Files](https://moonshotai.github.io/kimi-cli/en/configuration/config-files.html)
- [Providers and Models](https://moonshotai.github.io/kimi-cli/en/configuration/providers.html)
- [Hooks Beta](https://moonshotai.github.io/kimi-cli/zh/customization/hooks.html)
- [KIMI Brand Guidelines](https://moonshotai.github.io/Branding-Guide/)
- [MoonshotAI/kimi-cli issues](https://github.com/MoonshotAI/kimi-cli/issues)
