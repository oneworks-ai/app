# 插件 Demo Extension

这个本地插件用于验证插件之间的扩展点。

它会通过 manifest 向 Plugin Demo 暴露的 `demo/quick-actions` 扩展点贡献一个快捷操作。client 入口同时使用 `ctx.extensionPoints.onAvailable('demo/quick-actions', callback)` 监听目标扩展点出现并记录扩展点元信息；点击贡献按钮会通过 scoped command runtime 调用本插件自己的 `demo-quick-action` 命令，并在命令里通过 `ctx.pluginApis.call('demo/describe-extension-point', input)` 调用 Demo 插件暴露的纯前端 API。

它还在左侧更多菜单里增加了一个状态命令，用于确认扩展插件已激活。

源码入口位于 `client/src/index.tsx`，宿主默认加载 `client/dist/index.js`。前端开发态会通过宿主 Vite dev server 加载 source entry；修改源码后也可以运行 `pnpm -C packages/plugins/demo-extension build`，用 Vite 生成提交 / 发布用的浏览器 ESM 产物。
