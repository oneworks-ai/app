# 项目托管与 CLI 管理

返回上级：[skills.md](../skills.md)

## 项目托管 Skills

如果项目维护者希望统一管理一组远端 skills，可以在 `.oo.config.json`、`.oo.config.yaml` 或 `.oo.config.yml` 里声明：

```yaml
skills:
  - frontend-design
  - example-source/default/public@design-review
  - name: design-review
    source: example-source/default/public
    rename: internal-review
  - source: larksuite/cli
    include:
      - "*"
```

支持两种写法：

- 字符串：和 `dependencies` 一样，支持 bare name、`source@skill`、以及完整 source path。
- 对象单 skill：`name` 表示远程 skill 名，`source` 表示 source path，`rename` 表示安装到本地后的 skill 名。
- 对象 collection：只写 `source` 并用 `include` 选择该 source 下的多个 skills；`"*"` 或省略 `include` 表示安装该 source 暴露的全部 skills。

`skills` 是项目推荐或可选 skill 的声明清单，不等于 runtime 已经可用。runtime 只加载已经安装到 `.oo/skills` 的 skill；如果声明了但还没有安装，One Works 可以提示用户运行 `oneworks skills install`，但不会在启动时自动下载。

面向用户直接选择的默认 skills 应放在 `skills` 配置里，而不是只藏在 plugin 的 `skills/` 目录里。plugin skill 机制继续保留，plugin skill 自己声明的远端依赖仍会安装到 `.oo/skills/.plugins/<plugin-instance>/<skill>`，用于隔离插件内部依赖。

如果你还需要给前端选择器提供候选 npm registry / skill source，或调整 home bridge，可以写 `skillsMeta`：

```yaml
skills:
  - frontend-design
  - name: design-review
    source: example-source/default/public
    rename: internal-review

skillsMeta:
  registries:
    - https://registry.example.com
  sources:
    - example-source/default/public
  homeBridge:
    enabled: false
```

这里：

- `skills`：项目声明的 skill 列表；runtime 不会因为声明而自动下载
- `skillsMeta.registries`：前端选择器可展示的候选 npm registry
- `skillsMeta.sources`：前端选择器可展示的候选 skill source
- `skillsMeta.homeBridge`：真实 home skill bridge 的开关和 roots

`skillsMeta.registries/sources` 只影响前端候选列表；真正安装哪个 registry，必须由 `skills[].registry` 或 CLI 参数明确给出。

知识库的「技能 > Registry 设置」是独立的 Registry 管理页。「添加 Registry」会把 source、显示名称和
npm registry 写进对应配置文件的 `skillRegistries`；旧版 `skillsMeta.sources` 仍可在这里查看和移除：

- 选择全局配置时，写入 `~/.oneworks/.oo.config.json`
- 选择 `.oo.config.json` 时，写入项目配置
- 选择 `.oo.dev.config.json` 时，写入本地用户配置

技能市场内置 Vercel、Anthropic 和 Microsoft 的官方 skill collection，无需先添加 Registry；进入市场时
会直接搜索这些来源。只有点击具体 skill 的安装按钮时，OneWorks 才会下载到 `.oo/skills`。每个 skill 都
提供「安装到项目」和「安装到全局」两个入口，分别把声明写入 `.oo.config.json` 或
`~/.oneworks/.oo.config.json`；Registry 所在配置层只决定搜索来源和 Registry 元数据，不限制安装目标。
自定义 Registry 仍可按上述方式添加。OneWorks 自带的 bundled/plugin skills 会直接显示在「项目技能」中，
当前没有单独运营一个公共 OneWorks Registry。

「技能 > Registry 设置」会同时展示这些内置官方来源和自定义 Registry。内置来源不能删除，只能通过开关
屏蔽；开关会在对应配置层写入同 source 的 `skillRegistries[].enabled`，设为 `false` 后商店不再搜索或安装该来源。

后续在技能市场页里点击安装时，One Works 会同时做两件事：

1. 按选择的「项目 / 全局」目标，把 skill 声明写入 `.oo.config.json` 或 `~/.oneworks/.oo.config.json`
2. 立即把 skill 安装到项目 `.oo/skills/<name>/`

这样：

- 项目配置声明的 skill 会被其他协作者同步拿到
- 本地配置声明的 skill 只对当前用户生效
- Registry 所在配置层只管理搜索来源和元数据；商店安装声明由按钮选择的项目或全局目标决定
- 后续由项目维护者通过 `oneworks skills install/update` 显式安装或更新

兼容旧调用时，如果安装 API 没有显式提供 target，声明仍按 Registry 所在配置层写回。

「项目技能」页的导入按钮位于「项目 / 全局」切换栏右侧。选择「项目」时，压缩包解压到当前 workspace 的
`.oo/skills`；选择「全局」时，解压到真实 Home 的 `~/.agents/skills`，并通过默认 home bridge 显示在全局维度。
压缩包必须按“一个顶层目录对应一个 skill”组织，并且每个目录都包含 `SKILL.md`。导入会拒绝超限或不安全的压缩包；
遇到同名 skill 时默认不会覆盖，只有 API 客户端显式以 force 重试才会替换，且多 skill 替换失败时会整体回滚。
同一物理 skills 目录已有导入进行时，并发导入会收到 HTTP 409，不会进入覆盖流程。

安装行为：

1. 普通 `oneworks` 和 server session 默认不会下载或更新这些 skills。
2. 项目维护者运行 `oneworks skills install` 时，CLI 会把声明的 skills 安装到 `.oo/skills`。
3. 目标路径默认是 `.oo/skills/<skill-name>/SKILL.md`；如果配置了 `rename`，则改为 `.oo/skills/<rename>/SKILL.md`。
4. 本地已存在且 lockfile hash 没有变化时，默认跳过，不会重复安装。
5. 如果本地 skill 被手动改过，安装或更新会终止，避免静默覆盖。

如果需要刷新这些已安装的 skills，显式运行 `oneworks skills update`。普通 `oneworks` 不负责下载或更新远端 skill。

启用 `rename` 后，One Works 会同时重写本地 `SKILL.md` frontmatter 里的 `name`，这样后续引用和 include 都按重命名后的本地 skill 名工作。

## 技能来源标记

知识库「技能 -> 项目」页会标出每个 skill 的来源：

- `~/.oneworks/.oo.config.json`：来自全局配置声明
- `.oo.config.json`：来自项目配置声明
- `.oo.dev.config.json`：来自本地用户配置声明
- `Project Default`：项目目录下手写或导入的默认本地 skill
- `Plugin`：来自已启用插件
- `Real Home`：来自真实 home 下被 bridge 进来的 skill

这个标记只描述“它为什么出现在当前项目里”，不会改变 skill 的加载优先级。

如果一个 skill 是项目希望用户主动安装和选择的默认能力，应优先作为 `.oo.config.*` 里的 `skills` 声明出现；`Plugin` 来源更适合插件内部能力和插件依赖，不适合作为项目推荐 skill 的唯一入口。

## extend 合并与重复声明

当一个 config 通过 `extend` 继承其他 config 时，`skills` 是追加合并，不是覆盖：

```yaml
# base
skills:
  - vendor/base-skills@base-review
```

```yaml
# project
extend: ./base.yaml
skills:
  - vendor/project-skills@project-review
```

最终等价于：

```yaml
skills:
  - vendor/base-skills@base-review
  - vendor/project-skills@project-review
```

重复声明的处理原则：

- 完全相同的声明视为幂等，实际只安装一份。
- 同一个本地 skill name 指向不同 source/registry 时会终止安装。
- metadata dependency 中同一个 skill 的版本约束不兼容时会终止安装。
- 避免在 extend 链路里重复声明同一个 skill 的不同版本；项目维护者应显式整理成一个声明。

## CLI 内置 Skills

`oneworks` CLI 默认会注入 `@oneworks/plugin-cli-skills`，提供一组不需要项目手动配置的通用说明型 skills。通常直接描述需求即可；只有需要强制指定某个 skill 时，才使用 `oneworks --include-skill <name> "任务描述"`。

- `oneworks-cli-quickstart`：说明 CLI 常用命令、配置命令和会话恢复方式。
- `oneworks-cli-print-mode`：说明 print 模式、stdin 控制和权限确认。
- `oneworks-model-services`：说明模型服务商配置、内置 provider id、默认 API 地址、后台入口、模型/余额/状态能力和写回规则。
- `create-entity`：按用户需求创建新的 One Works entity。
- `update-entity`：按用户需求更新已有 One Works entity，强调最小改动和维护引用关系。
- `create-plugin`：理解用户想要的 plugin 效果；需求不明确时先列出不确定点让用户确认，再转成 One Works plugin manifest、前端入口、server 入口和验证步骤。

## `oneworks skills` 命令

`oneworks` 自带一组项目级 skill 管理命令：

`oneworks skills add <skill>`、`oneworks skills install [skills...]`、`oneworks skills update [skills...]`、`oneworks skills remove <skill>`、`oneworks skills publish <skill-or-path>`。

常见用法：

- `oneworks skills add design-review --source example-source/default/public --rename internal-review`：把 skill 声明写进项目配置，并立即安装到 `.oo/skills/internal-review`。
- `oneworks skills add lynx-cat --source example-source/lynx/skills --registry https://registry.example.com --version 1.0.3`：把 registry/source/version 一起写进项目配置；后续由 `oneworks skills install/update` 按这条 spec 安装或更新。
- `oneworks skills install`：安装当前启用配置层里声明的 skills，并安装它们的 metadata dependencies；未关闭全局配置时包含 `~/.oneworks/.oo.config.json`，随后包含项目和本地配置。
- `oneworks skills update`：强制刷新当前启用配置层里声明的 skills 和依赖。
- `oneworks skills remove internal-review`：从项目配置中移除匹配 skill，并删除本地安装目录。

安装或更新会写入 `.oo/skills.lock.yaml`，记录安装路径、source/version、依赖关系和目录 hash。`extend` 链里的声明会安装到 `.oo/skills/.extends/<config-name>/` 下，当前配置 source 的声明安装到 `.oo/skills/` 下；plugin skill 引入的远端依赖会安装到 `.oo/skills/.plugins/<plugin-instance>/<skill>`，不会混入普通 project skills。

`oneworks skills publish` 用来把项目里已经安装的 skill、本地路径或远程发布 spec 发布到支持 publish 的 `skills` 平台，例如 `oneworks skills publish internal-review --group default/public --region cn --access restricted -y`。

如果某个本地 skill 需要默认发布到一组固定参数，可以在 `SKILL.md` frontmatter 里写：

```yaml
---
name: internal-review
metadata:
  publish:
    source: example-source/default/public
    group: default/public
    region: cn
---
```

`metadata.publish.source` 会匹配对应 source 的默认发布参数；命令行显式传入的 `--registry / --group / --region / --access` 仍然优先。执行 `oneworks skills publish internal-review` 时，CLI 会自动补全 source 对应的 npm registry 和 registry/skill metadata 中的默认发布参数。公开版 `skills@latest` 默认不支持 `publish`；需要时可通过 `--registry` 指向支持 publish 的 skills CLI 包源。
