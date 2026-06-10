# @oneworks/plugin-cli-skills

给 `oneworks` CLI 提供一组通用说明型 skills，覆盖常用命令、config 子命令、print 模式、权限确认与恢复会话。

主要资产：

- `oneworks-cli-quickstart`
- `oneworks-cli-print-mode`
- `oneworks-channel`
- `oneworks-mem`
- `create-entity`
- `update-entity`
- `create-plugin`

其中：

- `oneworks-cli-quickstart` 负责解释 `oneworks` / `oneworks list` / `oneworks --resume`，以及 `oneworks config list|get|set|unset` 的基本用法。
- `oneworks config` 的读命令默认面向 merged config；文本模式输出 YAML。
- `oneworks config get models` / `oneworks config list models` 在文本模式下会把 `modelServices` 和 `models` metadata 合成可读视图；`--json` 仍返回原始配置结构。
- `oneworks-channel` 负责说明 agent 如何在 channel session 中按需显式发送文本、图片、文件或平台自定义表情，并强调群聊不会自动透传过程消息；emoji registry 会说明按平台查询、发送、备注和打标签，微信文本 @ 会说明对应 CLI 用法。
- `oneworks-mem` 负责说明 agent 如何在 channel / user / session / global 维度读写持久记忆，以及什么时候该读取或追加记忆。
- `create-entity` 负责按用户需求创建新的 OneWorks entity，覆盖文件布局、frontmatter、继承、规则和技能引用。
- `update-entity` 负责按用户需求更新已有 OneWorks entity，强调最小改动、保留现有内容和维护引用关系。
- `create-plugin` 负责理解用户想要的 plugin 效果；需求不明确时先列出不确定点让用户确认，再转换为 OneWorks plugin manifest、前端入口、server 入口和验证步骤。

典型接入方式：

```json
{
  "plugins": [
    {
      "id": "@oneworks/plugin-cli-skills"
    }
  ]
}
```

`@oneworks/cli` 会默认注入这个插件，所以通过 CLI 运行时通常不需要再手动配置。
