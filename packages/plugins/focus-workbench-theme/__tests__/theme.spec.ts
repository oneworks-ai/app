import { readFileSync } from 'node:fs'

import { describe, expect, it, vi } from 'vitest'

import { activatePlugin, focusWorkbenchTheme, normalizeFocusWorkbenchThemeSettings } from '../client/src/index'

describe('focus workbench theme plugin', () => {
  it('owns its theme recipe and defaults', () => {
    expect(focusWorkbenchTheme).toMatchObject({
      id: 'focus-workbench',
      primaryColor: '#006dcc',
      title: { en: 'Codex', 'zh-Hans': 'Codex 主题' }
    })
    expect(focusWorkbenchTheme.settingsTabs.map(tab => tab.id)).toEqual(['colors', 'density', 'components'])
    expect(normalizeFocusWorkbenchThemeSettings(undefined)).toMatchObject({
      overrides: {
        colors: { dividers: true, surfaces: true },
        density: { buttonPadding: { enabled: true, value: 5 }, iconSize: { enabled: true, value: 16 } }
      }
    })
  })

  it('clamps numeric presets and registers through the theme extension point', () => {
    expect(
      normalizeFocusWorkbenchThemeSettings({
        overrides: { density: { buttonPadding: { value: 2 }, iconSize: { value: 99 } } }
      })
    )
      .toMatchObject({ overrides: { density: { buttonPadding: { value: 5 }, iconSize: { value: 24 } } } })
    const dispose = vi.fn()
    const register = vi.fn(() => ({ dispose }))
    expect(activatePlugin({ themes: { register } })).toEqual({ dispose })
    expect(register).toHaveBeenCalledWith(focusWorkbenchTheme)
  })

  it('maps its low-noise geometry through the shared launcher contract', () => {
    const themeCss = readFileSync(new URL('../client/src/theme.css', import.meta.url), 'utf8')

    expect(themeCss).toContain('--oneworks-launcher-shell-radius: var(--oneworks-surface-radius)')
    expect(themeCss).toContain('--oneworks-launcher-shell-backdrop-filter: none')
    expect(themeCss).not.toContain('.launcher-route')
  })
})
