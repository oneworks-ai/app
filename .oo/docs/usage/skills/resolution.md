# 依赖解析与运行时行为

返回上级：[skills.md](../skills.md)

## 解析顺序

One Works 会按这个顺序处理依赖与候选 skill：

1. 扫描当前 workspace 的 `.oo/skills`
2. 扫描已启用插件提供的 skills
3. 扫描 plugin 依赖安装目录 `.oo/skills/.plugins`
4. 桥接支持的 home skill roots
5. 依赖解析时优先在项目、插件和 plugin 依赖里按名称匹配
6. 对纯名称依赖，如果只有 home-bridge skill 命中，才回退到 home skill
7. 对已安装依赖继续递归解析

如果本地存在多个同名或同 slug 的 skill，会报歧义错误。遇到这种情况，建议给插件实例配置 `scope`，再在引用处使用 `scope/name`。

面向用户直接选择的项目默认 skills 应通过 `.oo.config.*` 的 `skills` 声明，并由 `oneworks skills install` 安装到 `.oo/skills`。插件提供的 skills 和 `.oo/skills/.plugins` 机制仍然存在，但不应作为项目推荐 skill 的唯一声明方式。

## 默认解析方式

运行时只解析已经落盘的 skills，不会调用 `skills find`、`skills add`，也不会修改 `.oo/skills`、用户 home 或 cache 目录。

项目维护者需要在安装阶段把依赖固化下来：

```bash
oneworks skills install
oneworks skills update
```

如果依赖写成 `source@skill`、`registry@source@skill@version` 或对象形式，source、registry、version 会在 `oneworks skills install/update` 阶段使用；运行时只消费安装结果和 `.oo/skills.lock.yaml`。

安装结果：

- project skills 写入 `.oo/skills/<skill>`
- project skill 的 metadata dependencies 一起写入 `.oo/skills/<dependency>`
- plugin skill 引入的远端依赖写入 `.oo/skills/.plugins/<plugin-instance>/<skill>`
- `.oo/skills/.plugins` 不会被当作普通 project skill 根目录扫描

如果插件被移除，下一次 `oneworks skills install/update` 会清理不再被 lockfile 引用的 plugin 依赖。

本地缺失依赖时，运行时会报错并提示项目维护者运行 `oneworks skills install` 或 `oneworks skills update`。

如果缺失的是配置里声明但尚未安装的 root skill，运行时应提示安装命令，例如 `oneworks skills install` 或 `oneworks skills install <name>`；普通启动不应因此自动下载。

知识库里的「技能 -> 市场」页使用配置里的 `skillsMeta.sources` 作为可搜索 source 候选；前端不会再直接调用某个固定的 skills hub HTTP 协议。列表和安装都间接通过 `skills` CLI 完成，本质上等价于：

```bash
skills add <source> --list
skills add <source> --skill <name> --agent universal --copy -y
```

页面上的安装动作不会只做一次性本地导入。它会先把 skill 写回对应配置文件里的 `skills` 声明，再安装到项目 `.oo/skills`；后续更新仍由项目维护者运行 `oneworks skills install/update` 完成。

## 与选择规则的关系

如果任务只显式选择父 skill：

```json
{
  "skills": {
    "include": ["app-builder"]
  }
}
```

`app-builder` 声明的依赖会自动加入同一次运行。
