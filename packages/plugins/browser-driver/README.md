# @oneworks/plugin-browser-driver

OneWorks 内置浏览器的 Agent 控制插件。它通过桌面端托管的受控 broker 操作当前 workspace / session 的 interaction-panel webview，用户不需要配置调试端口或启动外部浏览器。

插件提供 `in_app_browser_*` 语义工具、单页面串行 workflow，以及跨页面并行 workflow。`in_app_browser_open` 默认在右侧打开，也可显式选择底部；其 `open_mode` 可以复用相同 URL，或明确新建 Tab。每个后续操作都必须传入对应的 `page_id`，多个 Tab 并存时不会隐式切换或串线。

页面级能力包括：显示、关闭、复制和在右侧/底部之间移动 Tab；刷新、停止加载、前进/后退、按索引或偏移跳转、分页读取及清空当前 Tab 历史；读取页面视图状态；列出设备预设、切换设备模式和视口参数；设置页面缩放；在当前页面内嵌打开或关闭 DevTools。`in_app_browser_show_page` 只让现有页面可见，不会重新创建或导航。复制和跨区域移动会返回新的 `page.id` / `replacement_page_id`，后续调用必须使用结果中的新 ID。

`execute_in_app_browser_workflows` 可在一次调用中并行处理多个独立页面，同一页面的操作仍严格排队。批量工作流只开放页面内安全、结果紧凑的操作；关闭、复制、移动、清空历史和读取完整历史等管理动作保持显式单次调用。插件不开放任意 JavaScript、原始 CDP、Cookie、Storage、密码或 OneWorks 外壳页面。

```json
{
  "plugins": [
    { "id": "browser-driver", "scope": "browser" }
  ]
}
```

配置后，skill 名称是 `browser/browser-driver`。
