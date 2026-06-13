# Workspace 调度

## 配置

大型仓库可以在根目录 `.oo.config.json` 里声明可调度的 workspace。workspace 不要求是 Git submodule，也可以是普通目录或指向目录的软链接。

最简单的写法：

```json
{
  "workspaces": {
    "include": ["services/*", "apps/*"],
    "exclude": ["services/legacy"]
  }
}
```

也可以给某些 workspace 指定稳定标识和描述：

```json
{
  "workspaces": {
    "include": ["services/*"],
    "entries": {
      "docs": {
        "path": "documentation",
        "description": "产品与接入文档"
      }
    }
  }
}
```

## 运行语义

- 在仓库根目录启动 `oneworks` 时，One Works 会把已声明 workspace 列入系统提示词。
- 当任务目标属于某个 workspace，agent 应通过 `oneworks agent start` / runtime protocol 启动子 runtime session，并在标题或初始消息里带上 workspace 标识与路径。
- 子任务会以目标 workspace 目录作为 cwd，重新加载该目录自己的 `.oo.config.*`、`.oo/` 数据资产、MCP、hooks 与 adapter 配置。
- 当前会话不需要直接修改已注册 workspace 内部代码；代码修改由对应 workspace 的子任务完成。

## CLI

命令行可直接指定 workspace：

```bash
oneworks --workspace billing "修复订单状态回滚问题"
```

`--workspace` 与 `--spec`、`--entity` 互斥。workspace 标识来自配置项 `entries` 的 key；通过 glob 发现的目录默认使用目录名，目录名冲突时使用相对路径。
