# 中国方案主题

这是一个独立发布、由用户选择安装的 OneWorks 主题插件；核心应用不会内置或默认启用它。安装并启用后会注册
`china-red` 主题包，并提供自己的多语言名称、配置标签页、
Ant Design token、CSS 覆盖和工作区横幅。

先在目标 workspace 安装发布包：

```bash
pnpm add -D @oneworks/plugin-china-red-theme
```

再在 `.oo.config.json` 中显式启用：

```json
{
  "plugins": [
    {
      "id": "@oneworks/plugin-china-red-theme",
      "scope": "china-red-theme"
    }
  ]
}
```

之后可在 **设置 → 主题** 中选择 **中国方案**。禁用或移除插件不会删除已经保存的主题
标识和配置，界面会安全回退到默认主题；重新启用插件后原配置会继续生效。
