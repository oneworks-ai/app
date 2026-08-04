// @vitest-environment happy-dom
import { readFileSync } from 'node:fs'

import { act, useState } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { NativeTabs } from '#~/components/native-tabs'

let container: HTMLDivElement
let root: Root

const renderKeyboardHarness = async () => {
  const Harness = () => {
    const [activeKey, setActiveKey] = useState('general')
    return (
      <>
        <NativeTabs
          activeKey={activeKey}
          ariaLabel='Settings sections'
          items={[
            {
              ariaControls: 'panel-general',
              icon: 'settings',
              id: 'tab-general',
              key: 'general',
              label: 'General'
            },
            {
              disabled: true,
              icon: 'bolt',
              key: 'disabled',
              label: 'Disabled'
            },
            {
              ariaControls: 'panel-appearance',
              icon: 'palette',
              id: 'tab-appearance',
              key: 'appearance',
              label: 'Appearance'
            }
          ]}
          onChange={setActiveKey}
        />
        <div aria-labelledby={`tab-${activeKey}`} id={`panel-${activeKey}`} role='tabpanel' />
      </>
    )
  }

  await act(async () => root.render(<Harness />))
}

const pressKey = async (element: Element, key: string) => {
  await act(async () => {
    element.dispatchEvent(
      new KeyboardEvent('keydown', {
        bubbles: true,
        cancelable: true,
        key
      })
    )
    await new Promise(resolve => requestAnimationFrame(resolve))
  })
}

describe('native tabs', () => {
  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
  })

  it('uses one keyboard and ARIA contract across host and plugin surfaces', async () => {
    await renderKeyboardHarness()

    const tabs = container.querySelectorAll<HTMLButtonElement>('[role="tab"]')
    expect(tabs).toHaveLength(3)
    expect(tabs[0]?.tabIndex).toBe(0)
    expect(tabs[1]?.tabIndex).toBe(-1)
    expect(tabs[2]?.tabIndex).toBe(-1)
    expect(tabs[0]?.getAttribute('aria-controls')).toBe('panel-general')

    tabs[0]?.focus()
    await pressKey(tabs[0]!, 'ArrowRight')

    expect(tabs[2]?.getAttribute('aria-selected')).toBe('true')
    expect(tabs[2]?.tabIndex).toBe(0)
    expect(document.activeElement).toBe(tabs[2])

    await pressKey(tabs[2]!, 'Home')
    expect(tabs[0]?.getAttribute('aria-selected')).toBe('true')
    expect(document.activeElement).toBe(tabs[0])
  })

  it('is the shared implementation for launcher and external-session tabs', () => {
    const nativeTabsStyles = readFileSync(
      'apps/client/src/components/native-tabs/NativeTabs.scss',
      'utf8'
    )
    const launcherSource = readFileSync(
      'apps/client/src/components/launcher/LauncherSettingsView.tsx',
      'utf8'
    )
    const externalSessionsSource = readFileSync(
      'apps/client/src/components/config/ExternalSessionsPanel.tsx',
      'utf8'
    )
    const configViewStyles = readFileSync(
      'apps/client/src/components/ConfigView.scss',
      'utf8'
    )

    expect(nativeTabsStyles).toContain('--native-tabs-tab-padding-block-end')
    expect(nativeTabsStyles).not.toContain('--subpage-tertiary-padding')
    expect(launcherSource).toContain('<NativeTabs')
    expect(externalSessionsSource).toContain('<NativeTabs')
    expect(externalSessionsSource).not.toContain('<Tabs')
    expect(configViewStyles).toMatch(
      /\.config-view__external-session-tabs\s*\+\s*\.config-view__external-session-tabs-panel\s*\{[^}]*margin-block-start:\s*0;/
    )
  })
})
