import { readFileSync } from 'node:fs'

import { describe, expect, it, vi } from 'vitest'

import { activatePlugin, chinaRedTheme, normalizeChinaRedThemeSettings } from '../client/src/index'

describe('china edition theme plugin', () => {
  it('owns its id, primary color, banner, tabs, and default settings', () => {
    expect(chinaRedTheme).toMatchObject({
      id: 'china-red',
      primaryColor: '#E23F12'
    })
    expect(chinaRedTheme.banner.artworkUrl).toBeTruthy()
    expect(chinaRedTheme.settingsTabs.map(tab => tab.id)).toEqual([
      'colors',
      'layout',
      'components',
      'banner'
    ])
    expect(normalizeChinaRedThemeSettings(undefined)).toMatchObject({
      showBanner: true,
      overrides: {
        colors: { backgrounds: true, borders: true },
        layout: {
          iconSize: { enabled: true, value: 16 },
          padding: { enabled: true, value: 10 }
        }
      }
    })
  })

  it('clamps settings and registers only through the theme extension point', () => {
    expect(normalizeChinaRedThemeSettings({
      overrides: {
        layout: {
          iconSize: { enabled: false, value: 99 },
          padding: { value: 1 }
        }
      },
      showBanner: false
    })).toMatchObject({
      showBanner: false,
      overrides: {
        layout: {
          iconSize: { enabled: false, value: 32 },
          padding: { enabled: true, value: 4 }
        }
      }
    })

    const dispose = vi.fn()
    const register = vi.fn(() => ({ dispose }))
    expect(activatePlugin({ themes: { register } })).toEqual({ dispose })
    expect(register).toHaveBeenCalledWith(chinaRedTheme)
  })

  it('maps its red and gold surfaces through the shared launcher contract', () => {
    const themeCss = readFileSync(new URL('../client/src/theme.css', import.meta.url), 'utf8')

    expect(themeCss).toContain('--oneworks-launcher-shell-border-color')
    expect(themeCss).toContain('--oneworks-launcher-window-shadow')
    expect(themeCss).not.toContain('.launcher-route')
  })
})
