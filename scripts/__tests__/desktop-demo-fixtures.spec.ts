// @vitest-environment happy-dom
/* eslint-disable no-new-func -- execute the generated page projection against a real DOM observer. */

import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import {
  createDesktopDemoFixture,
  getDesktopDemoFixtureEnvironment,
  getDesktopDemoFixturePageSetupExpression,
  getDesktopDemoFixtureWorkspace,
  parseDesktopDemoFixtureId
} from '../demo-video/desktop-fixtures'

const runPageSetup = (expression: string) => (
  new Function(`return ${expression}`)() as boolean
)

const settleMutations = async () => {
  for (let index = 0; index < 4; index += 1) {
    await new Promise(resolve => setTimeout(resolve, 0))
  }
}

afterEach(() => {
  const fixtureWindow = window as typeof window & {
    __oneworksDesktopDemoFixtureObserver?: MutationObserver
  }
  fixtureWindow.__oneworksDesktopDemoFixtureObserver?.disconnect()
  delete fixtureWindow.__oneworksDesktopDemoFixtureObserver
  document.body.replaceChildren()
  document.title = ''
})

describe('desktop demo fixtures', () => {
  it('builds deterministic safe adapter promo data around the real workspace', () => {
    const fixture = createDesktopDemoFixture({
      id: 'adapter-promo',
      workspace: '/tmp/source-workspace'
    })

    expect(fixture).toEqual({
      directories: [
        '/Users/oneworks/Desktop',
        '/Users/oneworks/Documents',
        '/Users/oneworks/Downloads',
        '/Users/oneworks/Projects',
        '/Users/oneworks/Projects/oneworks-demo'
      ],
      home: '/Users/oneworks',
      id: 'adapter-promo',
      schemaVersion: 1,
      workspaces: [{
        actualPath: path.resolve('/tmp/source-workspace'),
        displayPath: '/Users/oneworks/Projects/oneworks-demo'
      }]
    })
    expect(getDesktopDemoFixtureWorkspace(fixture)).toBe('/Users/oneworks/Projects/oneworks-demo')
    expect(getDesktopDemoFixtureEnvironment(fixture)).toEqual({
      ONEWORKS_DESKTOP_RECORDING_DEMO_FIXTURE: JSON.stringify(fixture),
      __ONEWORKS_PROJECT_DISABLE_DEV_CONFIG__: '1',
      __ONEWORKS_PROJECT_DISABLE_GLOBAL_CONFIG__: '1'
    })
    const pageSetupExpression = getDesktopDemoFixturePageSetupExpression(fixture)
    expect(pageSetupExpression).toContain('demo@oneworks.ai')
    expect(pageSetupExpression).toContain('Bug Fix')
    expect(pageSetupExpression).toContain('Code Review')
    expect(pageSetupExpression).toContain('Documentation')
    expect(pageSetupExpression).toContain('Demo User')
    expect(pageSetupExpression).toContain('Demo session')
    expect(pageSetupExpression).toContain('演示用户')
    expect(pageSetupExpression).toContain('.launcher-command-item__title')
    expect(pageSetupExpression).toContain('.session-title-text')
    expect(pageSetupExpression).toContain('element.textContent !== value')
    expect(pageSetupExpression).toContain('source-workspace')
    expect(pageSetupExpression).toContain('.chat-header-title-project')
  })

  it.each(['oneworks', 'demo', 'app'])(
    'settles the real DOM observer without globally replacing the %s workspace token',
    async (workspaceName) => {
      const fixture = createDesktopDemoFixture({
        id: 'adapter-promo',
        workspace: `/tmp/${workspaceName}`
      })
      document.documentElement.lang = 'en'
      document.body.innerHTML = `
        <span id="unrelated">${workspaceName} application mapping oneworks demo</span>
        <span id="template">Bug 修复模式</span>
        <span id="email">private@example.com</span>
        <span class="chat-header-title-project" title="/tmp/${workspaceName}">${workspaceName}</span>
        <span class="account-select"><span class="ant-select-selection-item">private@example.com · Personal</span></span>
        <div class="launcher-command-item">
          <span class="launcher-command-item__title">Private Person</span>
          <span class="launcher-command-item__subtitle">Frequent account</span>
        </div>
        <span class="session-title-text">Private session title</span>
      `
      let mutationCount = 0
      const auditObserver = new MutationObserver((records) => {
        mutationCount += records.length
      })
      auditObserver.observe(document.body, { characterData: true, childList: true, subtree: true })

      expect(runPageSetup(getDesktopDemoFixturePageSetupExpression(fixture))).toBe(true)
      await settleMutations()
      expect(document.querySelector('#unrelated')?.textContent)
        .toBe(`${workspaceName} application mapping oneworks demo`)
      expect(document.querySelector('#template')?.textContent).toBe('Bug Fix')
      expect(document.querySelector('#email')?.textContent).toBe('demo@oneworks.ai')
      const workspaceLabel = document.querySelector('.chat-header-title-project')
      expect(workspaceLabel?.textContent).toBe('oneworks-demo')
      expect(workspaceLabel?.getAttribute('title')).toBe('/Users/oneworks/Projects/oneworks-demo')
      expect(document.querySelector('.account-select .ant-select-selection-item')?.textContent)
        .toBe('demo@oneworks.ai · Demo')
      expect(document.querySelector('.launcher-command-item__title')?.textContent).toBe('Demo User')
      expect(document.querySelector('.session-title-text')?.textContent).toBe('Demo session')

      const settledMutationCount = mutationCount
      await settleMutations()
      expect(mutationCount).toBe(settledMutationCount)

      expect(runPageSetup(getDesktopDemoFixturePageSetupExpression(fixture))).toBe(true)
      await settleMutations()
      expect(mutationCount).toBe(settledMutationCount)

      const template = document.querySelector('#template')
      if (template == null) throw new Error('Template test node is missing.')
      template.textContent = '代码评审模式'
      await settleMutations()
      expect(template.textContent).toBe('Code Review')
      auditObserver.disconnect()
    }
  )

  it('fails closed for unknown fixture names', () => {
    expect(() => parseDesktopDemoFixtureId('private-home')).toThrow('Unknown desktop demo fixture')
  })
})
