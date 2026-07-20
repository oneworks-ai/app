import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { PluginThemeBanner } from '#~/components/layout/PluginThemeBanner'
import type { PluginThemeBannerRegistration, PluginThemeRuntimeRegistration } from '#~/plugins/plugin-theme-contract'
import {
  getThemePackSettings,
  mergeAppearanceConfigForEditing,
  normalizeAppearanceThemePack
} from '#~/utils/appearance-config'
import {
  applyThemePackToDocument,
  buildThemePackConfig,
  getThemePack,
  getThemePackPrimaryColor,
  normalizeThemePackSettings,
  resolveThemePackPrimaryColor,
  shouldShowThemeBanner
} from '#~/utils/theme-pack'

const theme: PluginThemeRuntimeRegistration = {
  id: 'fixture-theme',
  pluginScope: 'fixture',
  title: { en: 'Fixture', 'zh-Hans': '测试主题' },
  description: 'Fixture theme',
  primaryColor: '#A20F12',
  normalizeSettings: value => ({
    enabled: (value as { enabled?: boolean } | undefined)?.enabled !== false,
    showBanner: (value as { showBanner?: boolean } | undefined)?.showBanner !== false,
    value: typeof (value as { value?: number } | undefined)?.value === 'number'
      ? (value as { value: number }).value
      : 10
  }),
  banner: {
    ariaLabel: 'Fixture',
    artworkUrl: '/fixture.png',
    ribbon: ['Test', 'Fixture'],
    slogan: 'Test',
    title: 'Fixture',
    topline: ['Test'],
    subtitle: '1.0',
    visiblePath: 'showBanner'
  },
  applyDocument: ({ root, settings }) => {
    root.dataset.fixtureEnabled = String(settings.enabled)
    return () => {
      delete root.dataset.fixtureEnabled
    }
  },
  createThemeConfig: () => ({ token: { borderRadius: 3 } })
}

describe('plugin theme packs', () => {
  beforeEach(() => {
    const properties = new Map<string, string>()
    vi.stubGlobal('document', {
      documentElement: {
        dataset: {},
        style: {
          getPropertyValue: (name: string) => properties.get(name) ?? '',
          removeProperty: (name: string) => properties.delete(name),
          setProperty: (name: string, value: string) => properties.set(name, value)
        }
      }
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('accepts plugin-owned ids and keeps per-theme settings independent', () => {
    expect(normalizeAppearanceThemePack('fixture-theme')).toBe('fixture-theme')
    expect(normalizeAppearanceThemePack('Invalid Theme')).toBe('default')
    expect(getThemePackSettings({
      themePacks: {
        'fixture-theme': { enabled: false, value: 18 },
        'another-theme': { density: 'compact' }
      }
    }, 'fixture-theme')).toEqual({ enabled: false, value: 18 })
  })

  it('merges resolved and raw plugin settings without losing nested values', () => {
    expect(mergeAppearanceConfigForEditing({
      themePacks: { 'fixture-theme': { nested: { inherited: true }, value: 10 } }
    }, {
      themePacks: { 'fixture-theme': { nested: { local: true } } }
    })).toEqual({
      themePacks: {
        'fixture-theme': {
          nested: { inherited: true, local: true },
          value: 10
        }
      }
    })
  })

  it('resolves registrations, settings, primary color, and banner visibility through the plugin contract', () => {
    const themes = [theme]
    expect(getThemePack('fixture-theme', themes)).toBe(theme)
    expect(getThemePack('missing', themes)).toBeUndefined()
    expect(getThemePackPrimaryColor('fixture-theme', themes)).toBe('#A20F12')
    expect(resolveThemePackPrimaryColor('fixture-theme', '#00B454', themes)).toBe('#A20F12')
    expect(resolveThemePackPrimaryColor('missing', '#00B454', themes)).toBe('#00B454')

    const settings = normalizeThemePackSettings(theme, { enabled: false, showBanner: false, value: 16 })
    expect(settings).toEqual({ enabled: false, showBanner: false, value: 16 })
    expect(shouldShowThemeBanner(theme, settings)).toBe(false)
    expect(shouldShowThemeBanner(theme, { ...settings, showBanner: true })).toBe(true)
  })

  it('keeps legacy single-value banner rows from crashing the host', () => {
    const banner = {
      ...theme.banner!,
      ribbon: 'Legacy ribbon' as unknown as PluginThemeBannerRegistration['ribbon'],
      topline: 'Legacy topline' as unknown as PluginThemeBannerRegistration['topline']
    }
    const markup = renderToStaticMarkup(
      <PluginThemeBanner banner={banner} isDarkMode={false} />
    )

    expect(markup).toContain('Legacy topline')
    expect(markup).toContain('Legacy ribbon')
  })

  it('applies and cleans plugin document state while unknown themes fall back to default', () => {
    const cleanup = applyThemePackToDocument('fixture-theme', theme, { enabled: true })
    expect(document.documentElement.dataset.oneworksThemePack).toBe('fixture-theme')
    expect(document.documentElement.dataset.fixtureEnabled).toBe('true')
    cleanup()
    expect(document.documentElement.dataset.oneworksThemePack).toBe('default')
    expect(document.documentElement.dataset.fixtureEnabled).toBeUndefined()

    applyThemePackToDocument('missing', undefined, {})()
    expect(document.documentElement.dataset.oneworksThemePack).toBe('default')
  })

  it('composes plugin tokens with the host theme algorithm and managed primary color', () => {
    const config = buildThemePackConfig({
      isDarkMode: false,
      primaryColor: '#00B454',
      settings: {},
      theme
    })
    expect(config.token).toMatchObject({ borderRadius: 3, colorPrimary: '#A20F12' })
    expect(config.algorithm).toBeDefined()
  })

  it('isolates malformed plugin callbacks from the host theme runtime', () => {
    const malformedTheme: PluginThemeRuntimeRegistration = {
      ...theme,
      normalizeSettings: () => {
        throw new Error('normalizer failed')
      },
      applyDocument: () => {
        throw new Error('document hook failed')
      },
      createThemeConfig: () => {
        throw new Error('theme config failed')
      }
    }

    expect(normalizeThemePackSettings(malformedTheme, {})).toEqual({})
    expect(() => applyThemePackToDocument('fixture-theme', malformedTheme, {})()).not.toThrow()
    expect(buildThemePackConfig({
      isDarkMode: true,
      primaryColor: '#00B454',
      settings: {},
      theme: malformedTheme
    })).toMatchObject({ token: { colorPrimary: '#A20F12' } })
  })
})
