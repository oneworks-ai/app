// @vitest-environment happy-dom
import { act } from 'react'
import type { PropsWithChildren, ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { LauncherSettingsView } from '#~/components/launcher/LauncherSettingsView'
import type { LauncherSettingsResetAction } from '#~/components/launcher/LauncherSettingsView'
import {
  electronOnlyLauncherSettingIds,
  getAvailableLauncherSettingIds,
  getLauncherUpdateExperienceTranslationKeys,
  launcherSettingIds,
  resolveLauncherSettingsRuntimePolicy
} from '#~/components/launcher/launcher-settings-runtime'
import en from '#~/resources/locales/en.json'
import zh from '#~/resources/locales/zh.json'

const runtimeState = vi.hoisted(() => ({
  configResponse: undefined as unknown,
  desktop: false,
  installedPwa: false,
  standaloneDeployment: false,
  themeMode: 'system'
}))
const runtimeSpies = vi.hoisted(() => ({
  mutateConfig: vi.fn(),
  resetGlobalInterfaceLanguage: vi.fn(),
  setThemeMode: vi.fn(),
  updateConfig: vi.fn(),
  updateGlobalInterfaceLanguage: vi.fn()
}))

vi.mock('#~/runtime-config', () => ({
  isDesktopClientMode: () => runtimeState.desktop,
  isStandaloneClientMode: () => runtimeState.standaloneDeployment
}))
vi.mock('antd', () => {
  const Empty = Object.assign(
    ({ description }: { description?: ReactNode }) => <div data-testid='empty'>{description}</div>,
    { PRESENTED_IMAGE_SIMPLE: 'simple' }
  )

  return {
    App: {
      useApp: () => ({ message: { error: vi.fn(), warning: vi.fn() } })
    },
    Empty,
    Switch: (props: Record<string, unknown>) => (
      <input
        aria-label={props['aria-label'] as string}
        checked={props.checked === true}
        readOnly
        type='checkbox'
      />
    ),
    Tooltip: ({ children }: PropsWithChildren) => <>{children}</>
  }
})
vi.mock('jotai', () => ({
  useAtom: () => [runtimeState.themeMode, runtimeSpies.setThemeMode]
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
    data: runtimeState.configResponse,
    mutate: runtimeSpies.mutateConfig
  })
}))
vi.mock('@oneworks/utils/pinyin-search', () => ({
  matchesPinyinSearch: (query: string, values: string[]) =>
    values.some(value => value.toLowerCase().includes(query.toLowerCase())),
  normalizePinyinSearchQuery: (query: string) => query.trim().toLowerCase()
}))
vi.mock('#~/api', () => ({
  getConfig: vi.fn(),
  updateConfig: (...args: unknown[]) => runtimeSpies.updateConfig(...args)
}))
vi.mock('#~/components/config/ConfigShortcutInput', () => ({
  ShortcutInput: ({ value }: { value: string }) => <input readOnly value={value} />
}))
vi.mock('#~/components/config/ProjectThemeColorSettingsControls', () => ({
  ProjectThemeColorSettingsControls: () => <div>app-icon-controls</div>
}))
vi.mock('#~/components/config/ThemeModeRadioGroup', () => ({
  ThemeModeRadioGroup: () => <div>theme-controls</div>
}))
vi.mock('#~/components/config/use-project-theme-preview-sources', () => ({
  useProjectThemePreviewSources: () => ({
    industrial: '/industrial.svg',
    linear: '/linear.svg',
    matrix: '/matrix.svg',
    metal: '/metal.svg'
  })
}))
vi.mock('#~/components/launcher/LauncherExternalSessionsView', () => ({
  LauncherExternalSessionsView: () => <div data-testid='external-sessions'>external-sessions</div>
}))
vi.mock('#~/components/mobile-aware-select/MobileAwareSelect', () => ({
  MobileAwareSelect: () => <select aria-label='mock-select' />
}))
vi.mock('#~/components/native-tabs', () => ({
  NativeTabs: ({ items, onChange }: {
    items: Array<{ key: string; label: ReactNode }>
    onChange?: (key: string) => void
  }) => (
    <div>
      {items.map(item => (
        <button key={item.key} data-tab-key={item.key} type='button' onClick={() => onChange?.(item.key)}>
          {item.label}
        </button>
      ))}
    </div>
  )
}))
vi.mock('#~/hooks/use-interface-language-config', () => ({
  useInterfaceLanguageConfig: () => ({
    resetGlobalInterfaceLanguage: runtimeSpies.resetGlobalInterfaceLanguage,
    updateGlobalInterfaceLanguage: runtimeSpies.updateGlobalInterfaceLanguage
  })
}))
vi.mock('#~/hooks/use-resolved-theme-mode', () => ({
  useResolvedThemeMode: () => ({ resolvedThemeMode: 'light' })
}))
vi.mock('#~/i18n', () => {
  const option = { label: 'English', searchKeywords: ['English', 'en'], shortLabel: 'EN', value: 'en' }
  return { appLanguageOptions: [option], getActiveAppLanguageOption: () => option }
})
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
let root: Root | undefined
let container: HTMLDivElement | undefined
const setWindowShell = (input: {
  desktop?: Window['oneworksDesktop']
  device?: Window['oneworksDeviceShell']
}) => {
  Object.defineProperty(window, 'oneworksDesktop', {
    configurable: true,
    value: input.desktop,
    writable: true
  })
  Object.defineProperty(window, 'oneworksDeviceShell', {
    configurable: true,
    value: input.device,
    writable: true
  })
}
const viewProps = (
  query: string,
  onResetActionChange: (action: LauncherSettingsResetAction | undefined) => void = vi.fn()
) => ({
  isSearchInputComposing: () => false,
  onExternalSessionsImportComplete: vi.fn(),
  onKeyboardHintsChange: vi.fn(),
  onQueryChange: vi.fn(),
  onResetActionChange,
  onSearchChromeChange: vi.fn(),
  query,
  workspaceProjects: []
})
const renderLauncherSettings = (query: string) => renderToStaticMarkup(<LauncherSettingsView {...viewProps(query)} />)
const mountLauncherSettings = async (
  query: string,
  onResetActionChange: (action: LauncherSettingsResetAction | undefined) => void
) => {
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => {
    root?.render(<LauncherSettingsView {...viewProps(query, onResetActionChange)} />)
  })
}
const expectDesktopSettingsVisibility = (visible: boolean) => {
  for (const [settingId, query] of desktopSettingQueries) {
    const html = renderLauncherSettings(query)
    expect(
      html.includes(`data-launcher-setting-id="${settingId}"`),
      `${settingId} visibility`
    ).toBe(visible)
  }
}
const expectUpdateExperienceAbsent = () => {
  const html = renderLauncherSettings('service worker')
  expect(html).not.toContain('data-launcher-setting-id="update-experience"')
  expect(html).not.toContain('launcher.settings.items.updateExperience')
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  vi.stubEnv('PROD', true)
  vi.stubGlobal('navigator', { serviceWorker: {} })
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
    configurable: true,
    value: vi.fn(),
    writable: true
  })
  runtimeState.desktop = false
  runtimeState.installedPwa = false
  runtimeState.standaloneDeployment = false
  runtimeState.themeMode = 'system'
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn((query: string) => ({
      matches: query === '(display-mode: standalone)' && runtimeState.installedPwa
    })),
    writable: true
  })
  const desktopConfig = {
    iconAppearance: 'system',
    iconBackground: 'solid',
    iconTheme: 'linear',
    retainedLauncherConfig: 'keep',
    syncAppIcon: true
  }
  runtimeState.configResponse = {
    sources: {
      global: {
        appearance: {},
        desktop: desktopConfig
      },
      merged: {
        appearance: {},
        desktop: desktopConfig
      }
    }
  }
  setWindowShell({})
  vi.clearAllMocks()
  runtimeSpies.mutateConfig.mockImplementation(async () => runtimeState.configResponse)
  runtimeSpies.updateConfig.mockResolvedValue(undefined)
})

afterEach(async () => {
  if (root != null) await act(async () => root?.unmount())
  root = undefined
  container?.remove()
  container = undefined
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('launcher settings runtime policy', () => {
  it('keeps a closed, unique setting ID set with exactly six Electron-only IDs', () => {
    expect(electronOnlyLauncherSettingIds).toEqual([
      'auto-update',
      'launch-at-login',
      'open-last-workspace-on-startup',
      'shortcut',
      'status-pin',
      'update-channel'
    ])
    expect(new Set(launcherSettingIds).size).toBe(launcherSettingIds.length)
    const withoutElectronOnly = launcherSettingIds.filter(
      settingId =>
        !electronOnlyLauncherSettingIds.includes(
          settingId as (typeof electronOnlyLauncherSettingIds)[number]
        )
    )
    expect(getAvailableLauncherSettingIds({ isElectron: true, runtime: 'electron', updaterAvailable: false })).toEqual(
      launcherSettingIds.filter(settingId => settingId !== 'update-experience')
    )
    expect(getAvailableLauncherSettingIds({ isElectron: false, runtime: 'web', updaterAvailable: true })).toEqual(
      withoutElectronOnly
    )
    expect(getAvailableLauncherSettingIds({ isElectron: false, runtime: 'pwa', updaterAvailable: true })).toEqual(
      withoutElectronOnly
    )
    expect(getAvailableLauncherSettingIds({ isElectron: false, runtime: 'web', updaterAvailable: false })).toEqual(
      withoutElectronOnly.filter(settingId => settingId !== 'update-experience')
    )
    for (const runtime of ['android', 'partial'] as const) {
      expect(getAvailableLauncherSettingIds({ isElectron: false, runtime, updaterAvailable: false })).toEqual(
        withoutElectronOnly.filter(settingId => settingId !== 'update-experience')
      )
    }
    expect(resolveLauncherSettingsRuntimePolicy({
      desktopPlatform: 'darwin',
      desktopShellKind: 'android',
      hasDesktopBridge: true,
      hasDeviceShellBridge: false,
      hasServiceWorker: true,
      isDesktopClient: true,
      isInstalledPwa: false,
      isProduction: true
    })).toMatchObject({ isElectron: false, runtime: 'android' })
  })
})

describe('launcher settings rendered runtime visibility', () => {
  it('uses real preload-shaped Electron fallback for exactly six controls and no update row', () => {
    runtimeState.desktop = true
    setWindowShell({
      desktop: {
        getDesktopSettings: vi.fn(),
        onDesktopSettingsChange: vi.fn(),
        platform: 'darwin',
        updateDesktopSettings: vi.fn()
      }
    })
    expect([...desktopSettingQueries.keys()]).toEqual(electronOnlyLauncherSettingIds)
    expectDesktopSettingsVisibility(true)
    expectUpdateExperienceAbsent()
  })

  it('lets legacy shell identity beat conflicting Electron fallbacks and map installed PWA', () => {
    runtimeState.desktop = true
    setWindowShell({ desktop: { platform: 'darwin', shellKind: 'android' } })
    expectDesktopSettingsVisibility(false)
    expectUpdateExperienceAbsent()
    setWindowShell({ desktop: { platform: 'darwin', shellKind: 'web' } })
    expectDesktopSettingsVisibility(false)
    expectUpdateExperienceAbsent()
    runtimeState.desktop = false
    let html = renderLauncherSettings('service worker')
    expect(html).toContain('launcher.settings.items.updateExperience.status.web')
    runtimeState.installedPwa = true
    html = renderLauncherSettings('service worker')
    expect(html).toContain('launcher.settings.items.updateExperience.status.pwa')
    expect(html).not.toContain('launcher.settings.items.updateExperience.status.web')
  })

  it('distinguishes neutral Web copy from actual matchMedia-installed PWA copy', () => {
    let html = renderLauncherSettings('service worker')
    expect(html).toContain('data-launcher-setting-id="update-experience"')
    expect(html).toContain('launcher-settings__runtime-status')
    expect(html).toContain('published_with_changes')
    expect(html).toContain('launcher.settings.items.updateExperience.status.web')
    expect(html).not.toContain('launcher.settings.items.updateExperience.status.pwa')
    runtimeState.standaloneDeployment = true
    html = renderLauncherSettings('service worker')
    expect(html).toContain('launcher.settings.items.updateExperience.status.web')
    expect(html).not.toContain('launcher.settings.items.updateExperience.status.pwa')
    runtimeState.installedPwa = true
    html = renderLauncherSettings('service worker')
    expect(html).toContain('launcher.settings.items.updateExperience.status.pwa')
    expect(html).not.toContain('launcher.settings.items.updateExperience.status.web')
  })

  it('omits active updater copy in development and without service-worker support', () => {
    vi.stubEnv('PROD', false)
    expectUpdateExperienceAbsent()
    vi.stubEnv('PROD', true)
    vi.stubGlobal('navigator', {})
    expectUpdateExperienceAbsent()
  })

  it('gives Android and unidentified partial bridges neither runtime-specific experience', () => {
    runtimeState.desktop = true
    setWindowShell({
      desktop: {
        getDesktopSettings: vi.fn(),
        platform: 'darwin',
        shellKind: 'electron',
        updateDesktopSettings: vi.fn()
      },
      device: { shellKind: 'android' }
    })
    expectDesktopSettingsVisibility(false)
    expectUpdateExperienceAbsent()
    runtimeState.desktop = false
    setWindowShell({ desktop: { getDesktopSettings: vi.fn(), updateDesktopSettings: vi.fn() } })
    expectDesktopSettingsVisibility(false)
    expectUpdateExperienceAbsent()
    expect(renderLauncherSettings('appicon')).toContain(
      'data-launcher-setting-id="app-icon"'
    )
  })

  it('preserves app-icon search, content-only sections, and the empty state', () => {
    expect(renderLauncherSettings('appicon')).toContain(
      'data-launcher-setting-id="app-icon"'
    )
    expect(renderLauncherSettings('external sessions')).toContain('data-testid="external-sessions"')
    const emptyHtml = renderLauncherSettings('hotkey')
    expect(emptyHtml).toContain('launcher.settings.empty')
    expect(emptyHtml).not.toContain('data-launcher-setting-id=')
  })
})

describe('launcher settings writes and section resets', () => {
  it.each(
    [
      ['authoritative Android', true, 'electron', 'android', 'darwin'],
      ['unidentified partial bridge', false, undefined, undefined, undefined]
    ] as const
  )('uses API config for %s appearance reset without raw desktop methods', async (
    _label,
    desktopClient,
    desktopShellKind,
    deviceShellKind,
    platform
  ) => {
    const getDesktopSettings = vi.fn()
    const updateDesktopSettings = vi.fn()
    const updateGlobalAppearanceConfig = vi.fn()
    runtimeState.desktop = desktopClient
    setWindowShell({
      desktop: {
        getDesktopSettings,
        platform,
        shellKind: desktopShellKind,
        updateDesktopSettings,
        updateGlobalAppearanceConfig
      },
      device: deviceShellKind == null ? undefined : { shellKind: deviceShellKind }
    })
    let resetAction: LauncherSettingsResetAction | undefined
    await mountLauncherSettings('appicon', action => {
      if (action != null) resetAction = action
    })
    await act(async () => {
      resetAction?.onClick()
      await Promise.resolve()
    })
    expect(resetAction?.key).toBe('appearance')
    expect(runtimeSpies.updateConfig).toHaveBeenCalledWith(
      'global',
      'desktop',
      expect.objectContaining({
        iconAppearance: 'system',
        iconBackground: 'solid',
        iconTheme: 'linear',
        retainedLauncherConfig: 'keep',
        syncAppIcon: true
      })
    )
    expect(getDesktopSettings).not.toHaveBeenCalled()
    expect(updateDesktopSettings).not.toHaveBeenCalled()
    expect(updateGlobalAppearanceConfig).not.toHaveBeenCalled()
  })
})

describe('launcher Web/PWA update copy', () => {
  it('binds locale keys to the existing service-worker install and activation contract', () => {
    expect(en.launcher.settings.items.updateExperience.description.web).toMatch(
      /load.*checks.*warms.*before activating/u
    )
    expect(en.launcher.settings.items.updateExperience.description.pwa).toMatch(
      /opened.*checks.*warms.*before activating/u
    )
    expect(zh.launcher.settings.items.updateExperience.description.web).toMatch(
      /加载.*检查.*激活前预热/u
    )
    expect(zh.launcher.settings.items.updateExperience.description.pwa).toMatch(
      /打开.*检查.*激活前预热/u
    )
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
