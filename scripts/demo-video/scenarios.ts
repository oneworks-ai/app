import type { DemoVideoScenario, DemoVideoScenarioInfo } from './types'

export const demoVideoScenarios = [
  {
    defaultDurationMs: 5_000,
    defaultFps: 5,
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
