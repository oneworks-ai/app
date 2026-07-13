/* eslint-disable max-lines -- demo scenarios stay colocated so scripted tours share selector helpers. */
import path from 'node:path'

import type { DemoVideoScenario, DemoVideoScenarioContext, DemoVideoScenarioInfo } from './types'

type DemoVideoSelectorInput = string | string[]

const dataAttributeSelector = (name: string, value: string) => `[${name}=${JSON.stringify(value)}]`

const toSelectorList = (input: DemoVideoSelectorInput) => Array.isArray(input) ? input : [input]

const launcherCommandIdSelector = (id: string) => [
  dataAttributeSelector('data-launcher-command-id', id),
  `[id=${JSON.stringify(id)}]`
]

const launcherCommandPathSelector = (commandPath: string) => {
  const directoryName = path.basename(commandPath) || commandPath
  return [
    dataAttributeSelector('data-launcher-command-path', commandPath),
    `[id=${JSON.stringify(`clone-destination:${encodeURIComponent(`${directoryName}:${commandPath}`)}`)}]`,
    `[id=${JSON.stringify(`project:${encodeURIComponent(commandPath)}`)}]`
  ]
}

const launcherCommandActionSelector = (actionLabel: string) => [
  dataAttributeSelector('data-launcher-command-action-label', actionLabel)
]

const launcherCommandDescendantSelector = (commandSelector: DemoVideoSelectorInput, descendantSelector: string) =>
  toSelectorList(commandSelector).map(selector => `${selector} ${descendantSelector}`)

const launcherCommandPrimarySelector = (commandSelector: DemoVideoSelectorInput) =>
  launcherCommandDescendantSelector(commandSelector, '.launcher-command-item__enter')

const launcherCommandSecondarySelector = (commandSelector: DemoVideoSelectorInput) =>
  launcherCommandDescendantSelector(commandSelector, '.launcher-command-item__secondary')

const chatRouteReadySelector = [
  '.chat-container.ready .chat-input-monaco[data-oneworks-sender-editor-ready="true"]',
  '.chat-container.ready .chat-messages.ready',
  '.chat-container.ready [data-oneworks-sender-editor-ready="true"]',
  '.sender-container--chat-surface [data-oneworks-sender-editor-ready="true"]'
].join(',')

const chatEditorSelector = [
  '.chat-input-monaco[data-oneworks-sender-editor-ready="true"] textarea.inputarea',
  '.chat-input-monaco[data-oneworks-sender-editor-ready="true"] .monaco-editor',
  '.sender-container--chat-surface [data-oneworks-sender-editor-ready="true"]'
].join(',')

const chatSendButtonSelector = '.chat-send-btn.active:not(.disabled)'
const launcherSearchInputSelector = '.launcher-command-search__input'
const launcherWorkspaceStartedSelector = [
  '.workspace-opening-overlay',
  chatRouteReadySelector
].join(',')
const launcherOpenWorkspaceActionMinRecordMs = 1_200
const shortSettleMs = 160

const uniqueSearchQueries = (values: string[]) => [
  ...new Set(values.map(value => value.trim()).filter(value => value !== ''))
]

const buildPathChain = (inputPath: string) => {
  const resolvedPath = path.resolve(inputPath)
  const chain = [resolvedPath]
  let currentPath = resolvedPath
  while (true) {
    const parentPath = path.dirname(currentPath)
    if (parentPath === currentPath) break
    chain.unshift(parentPath)
    currentPath = parentPath
  }
  return chain
}

const tryClickSelector = async (
  ctx: DemoVideoScenarioContext,
  selectorInput: DemoVideoSelectorInput,
  input: {
    settleMs?: number
    timeoutMs?: number
  } = {}
) => {
  for (const selector of toSelectorList(selectorInput)) {
    try {
      await ctx.clickSelector(selector, {
        settleMs: input.settleMs ?? shortSettleMs,
        timeoutMs: input.timeoutMs ?? 650
      })
      return true
    } catch {
      // Try the next selector form. Scenarios support both current data attrs and older DOM ids.
    }
  }
  return false
}

const openWorkspaceThroughLauncherDirectoryBrowser = async (
  ctx: DemoVideoScenarioContext,
  workspace: string
) => {
  const workspacePath = path.resolve(workspace)
  const pathChain = buildPathChain(workspacePath)
  const parentPathCandidates = pathChain.slice(0, -1).toReversed()

  for (let attempt = 0; attempt < pathChain.length + 20; attempt += 1) {
    const targetOpened = await tryClickSelector(
      ctx,
      launcherCommandPrimarySelector(launcherCommandPathSelector(workspacePath)),
      {
        settleMs: 220,
        timeoutMs: 700
      }
    )
    if (targetOpened) return

    let descended = false
    for (const candidate of parentPathCandidates) {
      descended = await tryClickSelector(
        ctx,
        launcherCommandSecondarySelector(launcherCommandPathSelector(candidate)),
        {
          settleMs: shortSettleMs,
          timeoutMs: 250
        }
      )
      if (descended) break
    }
    if (descended) continue

    const steppedBack = await tryClickSelector(
      ctx,
      launcherCommandPrimarySelector(launcherCommandActionSelector('back')),
      {
        settleMs: shortSettleMs,
        timeoutMs: 250
      }
    )
    if (steppedBack) continue

    await ctx.recordFor(250)
  }

  throw new Error(`Timed out opening workspace from launcher directory browser: ${workspacePath}`)
}

const replaceLauncherSearch = async (
  ctx: DemoVideoScenarioContext,
  query: string,
  input: {
    settleMs?: number
  } = {}
) => {
  await ctx.clickSelector(launcherSearchInputSelector, {
    settleMs: 80,
    timeoutMs: 10_000
  })
  await ctx.selectTextInSelector(launcherSearchInputSelector, { timeoutMs: 2_000 })
  if (query === '') {
    await ctx.pressKey('Backspace', { settleMs: input.settleMs ?? 80 })
    return
  }
  await ctx.typeText(query, { settleMs: input.settleMs ?? 140 })
}

const tryOpenLauncherCommandFromVisibleRow = async (
  ctx: DemoVideoScenarioContext,
  selectorInput: DemoVideoSelectorInput,
  input: {
    startupTimeoutMs?: number
    timeoutMs?: number
  } = {}
) => {
  const waitForWorkspaceStarted = async (timeoutMs: number) => {
    try {
      await ctx.recordUntilSelector(launcherWorkspaceStartedSelector, { timeoutMs })
      return true
    } catch {
      return false
    }
  }

  const clicked = await tryClickSelector(ctx, selectorInput, {
    settleMs: 80,
    timeoutMs: input.timeoutMs ?? 2_000
  })
  if (!clicked) return false

  await ctx.pressKey('Enter', { settleMs: 180 })

  return waitForWorkspaceStarted(input.startupTimeoutMs ?? 12_000)
}

const searchAndOpenWorkspace = async (
  ctx: DemoVideoScenarioContext,
  workspace: string,
  input: {
    queries?: string[]
    timeoutMs?: number
  } = {}
) => {
  const workspacePath = path.resolve(workspace)
  const searchQueries = uniqueSearchQueries(
    input.queries ?? [
      path.basename(workspacePath),
      workspacePath
    ]
  )

  for (const query of searchQueries) {
    await replaceLauncherSearch(ctx, query)
    const commandSelector = launcherCommandPathSelector(workspacePath)
    const openedFromRow = await tryOpenLauncherCommandFromVisibleRow(
      ctx,
      commandSelector,
      {
        startupTimeoutMs: 12_000,
        timeoutMs: input.timeoutMs ?? 2_000
      }
    )
    if (openedFromRow) return true
  }

  return false
}

const openWorkspaceThroughLauncherUi = async (
  ctx: DemoVideoScenarioContext,
  input: {
    settleMs?: number
  } = {}
) => {
  const workspace = ctx.requireWorkspace()
  if (ctx.url != null) {
    await ctx.navigate(ctx.url)
  }
  await ctx.recordUntilSelector(launcherSearchInputSelector, { timeoutMs: 30_000 })
  const workspacePath = path.resolve(workspace)
  await ctx.recordDuring(launcherOpenWorkspaceActionMinRecordMs, async () => {
    const enteredOpenWorkspaceMode = await tryClickSelector(
      ctx,
      launcherCommandPrimarySelector(launcherCommandIdSelector('open-folder')),
      {
        settleMs: 180,
        timeoutMs: 20_000
      }
    )
    if (!enteredOpenWorkspaceMode) {
      throw new Error('Launcher Open Project command is not visible.')
    }
    const openedFromDirectorySearch = await searchAndOpenWorkspace(ctx, workspace, {
      queries: [workspacePath],
      timeoutMs: 1_000
    })
    if (!openedFromDirectorySearch) {
      await replaceLauncherSearch(ctx, '')
      await openWorkspaceThroughLauncherDirectoryBrowser(ctx, workspace)
    }
  })
  await ctx.recordUntilSelector(chatRouteReadySelector, { timeoutMs: 90_000 })
  await ctx.recordUntilSelectorAbsent('.workspace-opening-overlay', { timeoutMs: 90_000 })
  const settleMs = input.settleMs ?? 500
  if (settleMs > 0) {
    await ctx.recordFor(settleMs)
  }
}

const buildChatSmokeExpectedReply = () => {
  const suffix = new Date().toISOString()
    .replace(/[-:.TZ]/gu, '')
    .slice(0, 14)
  return `OK_CHAT_SMOKE_${suffix}`
}

const buildChatSmokePrompt = (expectedReply: string) => (
  `请只回复下面字符去掉空格后的结果，不要解释：${Array.from(expectedReply).join(' ')}`
)

const buildBrowserDriverExpectedReply = () => {
  const suffix = new Date().toISOString()
    .replace(/[-:.TZ]/gu, '')
    .slice(0, 14)
  return `OK_BROWSER_DRIVER_${suffix}`
}

const buildBrowserDriverPrompt = (pageOrigin: string, expectedReply: string) => (
  '请使用当前工作区的 browser/browser-driver skill 验证内置浏览器，不要使用外部浏览器，也不要修改代码。' +
  `先在默认右侧打开 ${pageOrigin}/ui/browser-use-lab.html?instance=right，` +
  '获取快照后，用 workflow 依次输入任务标题 Browser Driver right page、原生选择 High、勾选确认、创建任务，并等待 Task created successfully。' +
  '在 right 页面使用 in_app_browser_scroll 向下滚动 640 像素，再向上滚动 -640 像素返回顶部。' +
  `再在底部打开 ${pageOrigin}/ui/browser-use-lab.html?instance=bottom，` +
  '获取第二个页面快照，输入 Browser Driver bottom page、选择 Urgent 并勾选确认。' +
  '调用 in_app_browser_list_pages，确认两个页面 ID 不同；随后分别使用各自 page_id 再获取快照，确认 right 页面仍是成功状态、bottom 页面仍是未提交状态。' +
  `全部成功后，只回复下面字符去掉空格后的结果，不要解释：${Array.from(expectedReply).join(' ')}`
)

const buildBrowserDriverCancelPrompt = (pageOrigin: string) => (
  '请使用当前工作区的 browser/browser-driver skill 验证内置浏览器，不要使用外部浏览器，也不要修改代码。' +
  `在默认右侧打开 ${pageOrigin}/ui/browser-use-lab.html?instance=cancel&dynamic_favicon=1，` +
  '获取快照后，用一个 workflow 依次输入任务标题 Browser Driver cancelled action、选择 High、勾选确认，' +
  '然后等待 30000 毫秒。现在开始执行；如果用户中断，立即停止且不要继续调用工具。'
)

export const demoVideoScenarios = [
  {
    defaultDurationMs: 5_000,
    defaultFps: 12,
    defaultViewport: {
      height: 900,
      width: 1440
    },
    description: '录制任意已准备好的页面，适合快速生成能力展示素材。',
    id: 'url-tour',
    requiresUrl: true,
    title: '通用页面展示',
    run: async (ctx) => {
      await ctx.navigate(ctx.requireUrl())
      await ctx.recordFor(ctx.durationMs)
    }
  },
  {
    defaultDurationMs: 5_000,
    defaultFps: 12,
    defaultViewport: {
      height: 900,
      width: 1440
    },
    description: '录制当前已经打开的 CDP 页面，不重新导航，适合 Electron renderer 或复杂 setup 后的页面。',
    id: 'current-page-tour',
    requiresUrl: false,
    title: '当前页面展示',
    run: async (ctx) => {
      await ctx.recordFor(ctx.durationMs)
    }
  },
  {
    defaultDurationMs: 25_000,
    defaultFps: 60,
    defaultViewport: {
      height: 900,
      width: 1440
    },
    description: '录制 Electron launcher 打开 workspace 的完整过渡，配合 system-window 跟随 One Works 窗口。',
    id: 'electron-launcher-workspace-tour',
    requiresUrl: false,
    title: 'Electron Launcher 打开 Workspace',
    run: async (ctx) => {
      const workspace = ctx.requireWorkspace()
      await ctx.waitForText('启动', { timeoutMs: 30_000 })
      await ctx.recordDuring(ctx.durationMs, async () => {
        await ctx.openDesktopWorkspace(workspace)
      })
    }
  },
  {
    defaultDurationMs: 25_000,
    defaultFps: 60,
    defaultViewport: {
      height: 900,
      width: 1440
    },
    description: '通过 launcher UI 点击“打开项目”，搜索目标目录并打开 workspace。',
    followCdpTargets: true,
    id: 'launcher-open-workspace-ui-tour',
    requiresUrl: false,
    title: 'Launcher UI 打开 Workspace',
    run: async (ctx) => {
      await openWorkspaceThroughLauncherUi(ctx)
    }
  },
  {
    defaultDurationMs: 90_000,
    defaultFps: 60,
    defaultViewport: {
      height: 900,
      width: 1440
    },
    description: '通过 launcher UI 打开 workspace，发送一条 Codex 对话 smoke 消息并等待回复。',
    followCdpTargets: true,
    id: 'launcher-open-workspace-chat-smoke',
    requiresUrl: false,
    title: 'Launcher UI 打开 Workspace 并发送消息',
    run: async (ctx) => {
      await openWorkspaceThroughLauncherUi(ctx, { settleMs: 300 })
      const expectedReply = buildChatSmokeExpectedReply()
      await ctx.clickSelector(chatEditorSelector, { settleMs: 120, timeoutMs: 15_000 })
      await ctx.focusSelector(chatEditorSelector, { timeoutMs: 15_000 })
      await ctx.typeText(buildChatSmokePrompt(expectedReply), { settleMs: 160 })
      await ctx.clickSelector(chatSendButtonSelector, { settleMs: 160, timeoutMs: 15_000 })
      await ctx.recordUntilText(expectedReply, { timeoutMs: 90_000 })
      await ctx.recordFor(3_000)
    }
  },
  {
    defaultDurationMs: 300_000,
    defaultFps: 30,
    defaultViewport: {
      height: 900,
      width: 1440
    },
    description: '通过聊天 Agent 使用 Browser Driver 操作右侧与底部两个内置页面，验证多 Tab 隔离。',
    followCdpTargets: true,
    id: 'launcher-browser-driver-agent-tour',
    requiresUrl: false,
    showActionCursor: false,
    title: 'Electron Browser Driver Agent 演示',
    run: async (ctx) => {
      await ctx.openDesktopWorkspace(ctx.requireWorkspace())
      await ctx.recordUntilSelector(chatRouteReadySelector, { timeoutMs: 90_000 })
      await ctx.recordUntilSelectorAbsent('.workspace-opening-overlay', { timeoutMs: 90_000 })
      await ctx.recordFor(300)
      const pageUrl = ctx.url == null ? undefined : new URL(ctx.url)
      if (pageUrl == null) throw new Error('Browser Driver demo requires the Electron renderer URL.')
      const expectedReply = buildBrowserDriverExpectedReply()
      await ctx.clickSelector('[aria-label="收起侧边栏"], [aria-label="Collapse sidebar"]', {
        settleMs: 400,
        timeoutMs: 15_000
      })
      await ctx.clickSelector(chatEditorSelector, { settleMs: 120, timeoutMs: 15_000 })
      await ctx.focusSelector(chatEditorSelector, { timeoutMs: 15_000 })
      await ctx.typeText(buildBrowserDriverCancelPrompt(pageUrl.origin), { settleMs: 160 })
      await ctx.clickSelector(chatSendButtonSelector, { settleMs: 160, timeoutMs: 15_000 })
      await ctx.recordUntilSelector('.chat-interaction-panel__dock-tab-agent-status', { timeoutMs: 90_000 })
      await ctx.recordFor(240)
      await ctx.clickSelector('.chat-send-btn.stop:not(.disabled)', { settleMs: 160, timeoutMs: 5_000 })
      await ctx.recordUntilSelectorAbsent('.chat-interaction-panel__dock-tab-agent-status', { timeoutMs: 15_000 })
      await ctx.recordUntilSelector('.chat-interaction-panel__dock-tab-favicon', { timeoutMs: 15_000 })
      await ctx.recordFor(1_000)
      await ctx.clickSelector(chatEditorSelector, { settleMs: 120, timeoutMs: 15_000 })
      await ctx.focusSelector(chatEditorSelector, { timeoutMs: 15_000 })
      await ctx.typeText(buildBrowserDriverPrompt(pageUrl.origin, expectedReply), { settleMs: 160 })
      await ctx.clickSelector(chatSendButtonSelector, { settleMs: 160, timeoutMs: 15_000 })
      await ctx.recordUntilText(expectedReply, { timeoutMs: 300_000 })
      await ctx.recordFor(4_000)
    }
  },
  {
    defaultDurationMs: 12_000,
    defaultFps: 5,
    defaultViewport: {
      height: 1000,
      width: 1600
    },
    description: '展示 Relay Admin 团队详情的成员、配置 Profiles、Secrets 三个子页。',
    id: 'relay-team-config-tabs',
    requiresUrl: true,
    title: 'Relay 团队配置 Tabs',
    run: async (ctx) => {
      const inputUrl = ctx.requireUrl()
      const startUrl = new URL(inputUrl).pathname.startsWith('/admin/')
        ? inputUrl
        : ctx.resolveUrl('/admin/teams')
      await ctx.navigate(startUrl)
      await ctx.clickSelector('.relay-team-panel__team-link', { settleMs: 800 })
      await ctx.waitForText('成员', { timeoutMs: 15_000 })
      await ctx.recordFor(2_000)
      await ctx.clickText('配置 Profiles', { exact: true, settleMs: 500 })
      await ctx.recordFor(2_500)
      await ctx.clickText('Secrets', { exact: true, settleMs: 500 })
      await ctx.recordFor(2_500)
      await ctx.clickText('成员', { exact: true, settleMs: 500 })
      await ctx.recordFor(1_500)
    }
  },
  {
    defaultDurationMs: 7_000,
    defaultFps: 6,
    defaultViewport: {
      height: 720,
      width: 1280
    },
    description: '点击首个输入控件，展示鼠标光标、文本输入和 Enter 按键 HUD。',
    id: 'keyboard-input-tour',
    requiresUrl: true,
    title: '键盘输入展示',
    run: async (ctx) => {
      await ctx.navigate(ctx.requireUrl())
      await ctx.clickSelector('input, textarea, [contenteditable="true"]', { settleMs: 400 })
      await ctx.typeText('OneWorks demo')
      await ctx.recordFor(800)
      await ctx.pressKey('Enter')
      await ctx.recordFor(1_500)
    }
  }
] satisfies DemoVideoScenario[]

export const listDemoVideoScenarios = (): DemoVideoScenarioInfo[] =>
  demoVideoScenarios.map(scenario => ({
    defaultDurationMs: scenario.defaultDurationMs,
    defaultFps: scenario.defaultFps,
    defaultViewport: scenario.defaultViewport,
    description: scenario.description,
    followCdpTargets: scenario.followCdpTargets,
    id: scenario.id,
    requiresUrl: scenario.requiresUrl,
    title: scenario.title
  }))

export const getDemoVideoScenario = (scenarioId: string) => {
  const scenario = demoVideoScenarios.find(item => item.id === scenarioId)
  if (scenario == null) {
    const available = demoVideoScenarios.map(item => item.id).join(', ')
    throw new Error(`Unknown demo video scenario "${scenarioId}". Available scenarios: ${available}`)
  }
  return scenario
}
