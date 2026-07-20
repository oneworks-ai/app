import { readFileSync } from 'node:fs'

import { describe, expect, it, vi } from 'vitest'

import { activatePlugin, normalizeWarmCoworkThemeSettings, warmCoworkTheme } from '../client/src/index'

describe('warm cowork theme plugin', () => {
  it('owns its theme recipe and 9/14/20 radius ladder', () => {
    expect(warmCoworkTheme).toMatchObject({
      id: 'warm-cowork',
      primaryColor: '#c9684d',
      title: { en: 'Cowork', 'zh-Hans': 'Cowork 主题' }
    })
    expect(warmCoworkTheme.settingsTabs.map(tab => tab.id)).toEqual(['colors', 'workspace', 'components'])
    expect(normalizeWarmCoworkThemeSettings(undefined)).toMatchObject({
      overrides: {
        colors: { palette: true, status: true },
        workspace: {
          controlRadius: { enabled: true, value: 9 },
          grid: true,
          groupRadius: { enabled: true, value: 14 },
          panelRadius: { enabled: true, value: 20 },
          shadows: true
        }
      }
    })
  })

  it('clamps radius presets and registers through the theme extension point', () => {
    expect(
      normalizeWarmCoworkThemeSettings({
        overrides: { workspace: { controlRadius: { value: -5 }, panelRadius: { value: 99 } } }
      })
    )
      .toMatchObject({ overrides: { workspace: { controlRadius: { value: 0 }, panelRadius: { value: 32 } } } })
    const dispose = vi.fn()
    const register = vi.fn(() => ({ dispose }))
    expect(activatePlugin({ themes: { register } })).toEqual({ dispose })
    expect(register).toHaveBeenCalledWith(warmCoworkTheme)
  })

  it('maps its warm surface ladder through the shared launcher contract', () => {
    const themeCss = readFileSync(new URL('../client/src/theme.css', import.meta.url), 'utf8')

    expect(themeCss).toContain('--oneworks-launcher-shell-radius: var(--oneworks-surface-radius)')
    expect(themeCss).toContain('--oneworks-launcher-action-size: var(--oneworks-cowork-control-size)')
    expect(themeCss).not.toContain('.launcher-route')
  })
})
