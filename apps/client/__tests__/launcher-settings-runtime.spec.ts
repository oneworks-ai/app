import { readFileSync } from 'node:fs'

import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { LauncherSettingsView } from '#~/components/launcher/LauncherSettingsView'
import {
  electronOnlyLauncherSettingIds,
  getAvailableLauncherSettingIds,
  getLauncherUpdateExperienceTranslationKeys,
  resolveLauncherSettingsRuntime
} from '#~/components/launcher/launcher-settings-runtime'
import { setupPwa } from '#~/pwa'
import en from '#~/resources/locales/en.json'
import zh from '#~/resources/locales/zh.json'

const runtimeClientMode = vi.hoisted(() => ({
  desktop: false,
  standalone: false
}))

vi.mock('#~/runtime-config', () => ({
  isDesktopClientMode: () => runtimeClientMode.desktop,
  isStandaloneClientMode: () => runtimeClientMode.standalone
}))

vi.mock('antd', () => {
  const Empty = Object.assign(
    ({ description }: { description?: React.ReactNode }) => React.createElement('div', null, description),
    { PRESENTED_IMAGE_SIMPLE: 'simple' }
  )

  return {
    App: {
      useApp: () => ({
        message: {
          error: vi.fn(),
          warning: vi.fn()
        }
      })
    },
    Empty,
    Switch: (props: Record<string, unknown>) =>
      React.createElement('input', {
        'aria-label': props['aria-label'],
        checked: props.checked,
        readOnly: true,
        type: 'checkbox'
      }),
    Tooltip: ({ children }: React.PropsWithChildren) => React.createElement(React.Fragment, null, children)
  }
})

vi.mock('jotai', () => ({
  useAtom: () => ['system', vi.fn()]
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    i18n: {
      language: 'en',
      resolvedLanguage: 'en'
    },
    t: (key: string) => key
  })
}))

vi.mock('swr', () => ({
  default: () => ({
    data: undefined,
    mutate: vi.fn()
  })
}))

vi.mock('@oneworks/utils/pinyin-search', () => ({
  matchesPinyinSearch: (query: string, values: string[]) =>
    values.some(value => value.toLowerCase().includes(query.toLowerCase())),
  normalizePinyinSearchQuery: (query: string) => query.trim().toLowerCase()
}))

vi.mock('#~/api', () => ({
  getConfig: vi.fn(),
  updateConfig: vi.fn()
}))

vi.mock('#~/components/config/ConfigShortcutInput', () => ({
  ShortcutInput: ({ value }: { value: string }) => React.createElement('input', { readOnly: true, value })
}))

vi.mock('#~/components/config/ProjectThemeColorSettingsControls', () => ({
  ProjectThemeColorSettingsControls: () => React.createElement('div', null, 'app-icon-controls')
}))

vi.mock('#~/components/config/ThemeModeRadioGroup', () => ({
  ThemeModeRadioGroup: () => React.createElement('div', null, 'theme-controls')
}))

vi.mock('#~/components/config/use-project-theme-preview-sources', () => ({
  useProjectThemePreviewSources: () => ({
    industrial: '/industrial.svg',
    linear: '/linear.svg',
    matrix: '/matrix.svg',
    metal: '/metal.svg'
  })
}))

vi.mock('#~/components/mobile-aware-select/MobileAwareSelect', () => ({
  MobileAwareSelect: () => React.createElement('select')
}))

vi.mock('#~/hooks/use-interface-language-config', () => ({
  useInterfaceLanguageConfig: () => ({
    resetGlobalInterfaceLanguage: vi.fn(),
    updateGlobalInterfaceLanguage: vi.fn()
  })
}))

vi.mock('#~/hooks/use-resolved-theme-mode', () => ({
  useResolvedThemeMode: () => ({
    resolvedThemeMode: 'light'
  })
}))

vi.mock('#~/i18n', () => ({
  appLanguageOptions: [{
    label: 'English',
    searchKeywords: ['English', 'en'],
    shortLabel: 'EN',
    value: 'en'
  }],
  getActiveAppLanguageOption: () => ({
    label: 'English',
    searchKeywords: ['English', 'en'],
    shortLabel: 'EN',
    value: 'en'
  })
}))

vi.mock('#~/plugins/plugin-themes', () => ({
  usePluginThemes: () => []
}))

vi.mock('#~/store/index.js', () => ({
  normalizeThemeMode: (value: string) => value,
  themeAtom: {}
}))

vi.mock('#~/utils/keyboard-events', () => ({
  deferImeCompositionEnd: vi.fn(),
  isImeCompositionKeyEvent: () => false
}))

vi.mock('#~/utils/shortcutUtils', () => ({
  getDesktopShortcutFromEvent: vi.fn(),
  parseShortcut: () => ({
    altKey: false,
    ctrlKey: true,
    metaKey: false
  })
}))

const desktopSettingQueries = new Map(
  [
    ['auto-update', 'auto update'],
    ['launch-at-login', 'auto launch'],
    ['open-last-workspace-on-startup', 'recent workspace'],
    ['shortcut', 'hotkey'],
    ['status-pin', 'menu bar'],
    ['update-channel', 'alpha']
  ] as const
)

const renderLauncherSettings = (
  query: string,
  windowValue: Partial<Window> = {}
) => {
  vi.stubGlobal('window', windowValue)
  return renderToStaticMarkup(
    React.createElement(LauncherSettingsView, {
      isSearchInputComposing: () => false,
      query,
      onKeyboardHintsChange: vi.fn(),
      onResetActionChange: vi.fn()
    })
  )
}

const expectDesktopSettingsVisibility = (
  windowValue: Partial<Window>,
  visible: boolean
) => {
  for (const [settingId, query] of desktopSettingQueries) {
    const html = renderLauncherSettings(query, windowValue)
    expect(
      html.includes(`data-launcher-setting-id="${settingId}"`),
      `${settingId} visibility`
    ).toBe(visible)
  }
}

beforeEach(() => {
  runtimeClientMode.desktop = false
  runtimeClientMode.standalone = false
  vi.unstubAllGlobals()
})

describe('launcher settings runtime', () => {
  it('models setting availability with the closed launcher setting ID set', () => {
    const electronSettings = getAvailableLauncherSettingIds('electron')
    const webSettings = getAvailableLauncherSettingIds('web')
    const pwaSettings = getAvailableLauncherSettingIds('pwa')
    const androidSettings = getAvailableLauncherSettingIds('android')

    expect(electronSettings).toEqual(expect.arrayContaining([...electronOnlyLauncherSettingIds]))
    expect(electronSettings).not.toContain('update-experience')
    expect(webSettings).toContain('update-experience')
    expect(pwaSettings).toContain('update-experience')
    expect(androidSettings).not.toContain('update-experience')
    for (const settingId of electronOnlyLauncherSettingIds) {
      expect(webSettings).not.toContain(settingId)
      expect(pwaSettings).not.toContain(settingId)
      expect(androidSettings).not.toContain(settingId)
    }
  })

  it('prioritizes an authoritative Android or Web shell over a partial desktop bridge', () => {
    expect(resolveLauncherSettingsRuntime({
      desktopPlatform: 'darwin',
      desktopShellKind: 'electron',
      deviceShellKind: 'android',
      isDesktopClient: true,
      isStandaloneClient: false
    })).toBe('android')
    expect(resolveLauncherSettingsRuntime({
      desktopPlatform: 'darwin',
      deviceShellKind: 'web',
      isDesktopClient: true,
      isStandaloneClient: true
    })).toBe('pwa')
  })

  it('keeps Web and PWA update copy keys aligned by runtime', () => {
    for (const runtime of ['web', 'pwa'] as const) {
      expect(getLauncherUpdateExperienceTranslationKeys(runtime)).toEqual({
        descriptionKey: `launcher.settings.items.updateExperience.description.${runtime}`,
        runtime,
        statusKey: `launcher.settings.items.updateExperience.status.${runtime}`,
        titleKey: `launcher.settings.items.updateExperience.title.${runtime}`
      })
    }
  })
})

describe('launcher settings rendered visibility', () => {
  it('renders desktop controls only for confirmed Electron', () => {
    runtimeClientMode.desktop = true
    const desktopBridge = {
      oneworksDesktop: {
        getDesktopSettings: vi.fn(),
        platform: 'darwin',
        updateDesktopSettings: vi.fn()
      }
    } as Partial<Window>

    expectDesktopSettingsVisibility(desktopBridge, true)
    expect(renderLauncherSettings('service worker', desktopBridge)).not.toContain(
      'data-launcher-setting-id="update-experience"'
    )
  })

  it('renders Web and PWA update experience without desktop labels', () => {
    expectDesktopSettingsVisibility({}, false)
    expect(renderLauncherSettings('service worker')).toContain(
      'data-launcher-setting-id="update-experience"'
    )

    runtimeClientMode.standalone = true
    expectDesktopSettingsVisibility({}, false)
    expect(renderLauncherSettings('service worker')).toContain(
      'launcher.settings.items.updateExperience.status.pwa'
    )
  })

  it('preserves app-icon search and the empty result when a hidden desktop setting is the only match', () => {
    expect(renderLauncherSettings('appicon')).toContain(
      'data-launcher-setting-id="app-icon"'
    )
    const emptyHtml = renderLauncherSettings('hotkey')
    expect(emptyHtml).toContain('launcher.settings.empty')
    expect(emptyHtml).not.toContain('data-launcher-setting-id=')
  })

  it('gives Android with a partial desktop bridge neither runtime-specific settings experience', () => {
    runtimeClientMode.desktop = true
    const partialAndroidBridge = {
      oneworksDesktop: {
        getDesktopSettings: vi.fn(),
        platform: 'darwin',
        updateDesktopSettings: vi.fn()
      },
      oneworksDeviceShell: {
        shellKind: 'android'
      }
    } as Partial<Window>

    expectDesktopSettingsVisibility(partialAndroidBridge, false)
    expect(renderLauncherSettings('service worker', partialAndroidBridge)).not.toContain(
      'data-launcher-setting-id="update-experience"'
    )
    expect(renderLauncherSettings('appicon', partialAndroidBridge)).toContain(
      'data-launcher-setting-id="app-icon"'
    )
  })
})

describe('launcher Web/PWA update wording', () => {
  it('describes the service-worker behavior exercised by production PWA setup', async () => {
    const loadListeners: Array<() => void> = []
    const register = vi.fn(() => Promise.resolve())
    vi.stubGlobal('navigator', {
      serviceWorker: {
        getRegistrations: vi.fn(() => Promise.resolve([])),
        register
      }
    })
    vi.stubGlobal('window', {
      addEventListener: (event: string, listener: () => void) => {
        if (event === 'load') loadListeners.push(listener)
      },
      location: {
        origin: 'https://oneworks.example'
      }
    })

    await setupPwa({
      clientBase: '/pwa',
      isDesktop: false,
      isProd: true
    })
    expect(register).not.toHaveBeenCalled()
    loadListeners[0]?.()
    expect(register).toHaveBeenCalledWith(
      expect.stringMatching(/^\/pwa\/sw\.js\?v=.+/u),
      { scope: '/pwa/' }
    )

    const serviceWorkerSource = readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8')
    expect(serviceWorkerSource).toContain('cacheAppShell()')
    expect(serviceWorkerSource).toContain('serviceWorkerGlobal.skipWaiting()')
    expect(serviceWorkerSource).toContain('serviceWorkerGlobal.clients.claim()')
    expect(en.launcher.settings.items.updateExperience.description.pwa).toMatch(
      /opened.*checks.*warms.*before activating/u
    )
    expect(en.launcher.settings.items.updateExperience.status.pwa).toMatch(/reopening or reloading/u)
    expect(zh.launcher.settings.items.updateExperience.description.pwa).toMatch(/打开.*检查.*预热.*激活/u)
    expect(zh.launcher.settings.items.updateExperience.status.pwa).toMatch(/重新打开或加载/u)
  })
})
