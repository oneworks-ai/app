# Launcher 组件维护说明

本目录承载 desktop launcher 内部视图组件，例如设置页、关于页和 launcher 专用控件。页面入口和 Electron preload 调用仍在 `src/routes/LauncherRoute.tsx`；窗口生命周期、workspace service、文件系统搜索实现留在 `apps/desktop/src/main/`。

## 体验边界

- Launcher 首屏是工具，不是设置页。默认状态优先服务“搜索、打开、执行”；设置、关于、语言这类 app 级入口放在左下角菜单里，不抢主流程。
- 左下角只承载 app 级入口，例如项目图标和菜单；右下角只表达当前选中项能做什么。不要把全局入口和当前 item 操作混在一起。
- 保持 command palette 的密度。控件要紧凑、可扫、少解释文本；不要把 launcher 做成 dashboard 或营销页。

## Footer 与按键提示

- Footer hint 使用稳定的 `kbd + label` 结构，多个 hint 之间用短的圆角分割线。
- Reset 属于当前设置 section 的 action，不是全局重置。footer 里只显示短文案“重置”，具体 section 通过 `aria-label` / `title` 表达。
- icon keycap 要单独看 glyph 视觉大小。Material Symbols 默认字形容易撑大视觉面积；必要时只缩 glyph，不要先硬压整个 keycap。

## 设置页

- 设置页按 section 组织，顶部是 tabs，下面是当前 section 的配置。
- section 以用户心智命名，例如 `通用 / 行为 / 外观`；不要把“图标”这类过窄分类单独做成 section，应用图标属于外观。
- tabs 必须 sticky pin 在设置列表顶部，并提供足够实的背景，避免滚动内容从下面透出影响识别。
- 重置按 section 维度处理。后续接真实数据时，重置动作应只还原当前 section 对应配置，不要偷偷扩大成全局 reset。

## 设置页快捷键

- section tabs 支持 `⌘1/⌘2/⌘3` 或 Windows/Linux 的 `Ctrl+1/2/3` 直达，tabs 聚焦时支持 `←/→` 和 `Home/End`。
- 快捷键提示不要常驻挤占标题。按住 Command/Ctrl 0.5s 后，才在 tab 标题右侧显示 shortcut chip；松开 modifier、窗口失焦或页面隐藏时立即收起。
- shortcut chip 必须带 tooltip，用于解释“按 xx 切换到 yy”。界面常态不写长说明。

## 输入法与快捷键

- 所有 launcher 内部 keydown 都必须避开 IME composition。组合输入期间不能响应 Enter、Esc、section 快捷键或 item 执行。
- 输入法判断复用 `src/utils/keyboard-events.ts`，不要在 launcher 里维护单独的 `keyCode === 229` 分支。
- 录入快捷键的输入框是特殊交互区；section shortcut reveal 和 launcher 全局 key handler 都不能干扰它。

## 视觉细节

- 毛玻璃不能只靠透明。浅色背景下标题、placeholder、section label、sticky tabs 都要有足够对比度。
- 图标表达当前模式或语义，不替代结构。输入框左侧保留当前模式图标；tab 和 setting item 用语义图标；不要在标题旁重复堆图标。
- 默认主题里的 command 选中行和设置 section tab 不铺 active 背景：command 使用左侧 indicator + 强调文字，section tab 使用强调文字 + 下划线表达选中。hover / focus 可以使用临时背景；显式主题包可以通过 `--oneworks-launcher-item-active-bg` 覆盖自己的选中语言。
- 目录浏览和插件路由面包屑统一使用共享的 `route-container-inline-breadcrumb`；launcher 只做密度、滚动和容器修饰，不再维护独立的面包屑按钮 / 分隔符组件样式。
- Tooltip 只做补充，例如文件搜索图标、section shortcut chip。不要把操作说明常驻在 UI 里。

## 回归

- 视觉或交互改动至少用真实 Electron 窗口看一遍，尤其是透明背景、毛玻璃、footer 尺寸、tooltip 边界和 sticky tabs。
- 改 Electron main/preload IPC 后必须重启 desktop dev app，不能只依赖 HMR。
- 最低静态检查：

```bash
pnpm exec eslint apps/client/src/components/launcher/*.tsx apps/client/src/routes/LauncherRoute.tsx
pnpm typecheck
pnpm -C apps/desktop typecheck
git diff --check
```
