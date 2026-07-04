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
        settleMs: input.settleMs ?? 500,
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
        settleMs: 700,
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
          settleMs: 500,
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
        settleMs: 500,
        timeoutMs: 250
      }
    )
    if (steppedBack) continue

    await ctx.recordFor(250)
  }

  throw new Error(`Timed out opening workspace from launcher directory browser: ${workspacePath}`)
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
  await ctx.recordFor(2_000)
  await ctx.recordDuring(10_000, async () => {
    const enteredOpenWorkspaceMode = await tryClickSelector(
      ctx,
      launcherCommandPrimarySelector(launcherCommandIdSelector('open-folder')),
      {
        settleMs: 800,
        timeoutMs: 20_000
      }
    )
    if (!enteredOpenWorkspaceMode) {
      throw new Error('Launcher Open Project command is not visible.')
    }
    await openWorkspaceThroughLauncherDirectoryBrowser(ctx, workspace)
  })
  await ctx.recordUntilSelector(chatRouteReadySelector, { timeoutMs: 90_000 })
  await ctx.recordUntilSelectorAbsent('.workspace-opening-overlay', { timeoutMs: 90_000 })
  const settleMs = input.settleMs ?? 2_500
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
    description: '通过 launcher UI 点击“打开项目”，逐级选择目录并打开 workspace。',
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
    id: 'launcher-open-workspace-chat-smoke',
    requiresUrl: false,
    title: 'Launcher UI 打开 Workspace 并发送消息',
    run: async (ctx) => {
      await openWorkspaceThroughLauncherUi(ctx, { settleMs: 600 })
      const expectedReply = buildChatSmokeExpectedReply()
      await ctx.clickSelector(chatEditorSelector, { settleMs: 400, timeoutMs: 15_000 })
      await ctx.focusSelector(chatEditorSelector, { timeoutMs: 15_000 })
      await ctx.typeText(buildChatSmokePrompt(expectedReply), { settleMs: 500 })
      await ctx.recordFor(500)
      await ctx.clickSelector(chatSendButtonSelector, { settleMs: 500, timeoutMs: 15_000 })
      await ctx.recordUntilText(expectedReply, { timeoutMs: 90_000 })
      await ctx.recordFor(3_000)
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
