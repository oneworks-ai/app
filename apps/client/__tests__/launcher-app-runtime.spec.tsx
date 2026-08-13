// @vitest-environment happy-dom
import { act } from 'react'
import type { ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { LauncherApp } from '#~/LauncherApp'
import type { LauncherSettingsResetAction } from '#~/components/launcher/LauncherSettingsView'
import { StandaloneRouteThemeProvider } from '#~/routes/StandaloneRouteThemeProvider'

const state = vi.hoisted(() => ({
  config: undefined as unknown,
  atomSetter: vi.fn(),
  pluginProviderProps: undefined as Record<string, unknown> | undefined,
  resetAction: undefined as LauncherSettingsResetAction | undefined,
  managerConnect: vi.fn(),
  updateConfig: vi.fn()
}))

vi.mock('antd', () => ({
  App: { useApp: () => ({ message: { error: vi.fn(), warning: vi.fn() } }) },
  ConfigProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
  Empty: Object.assign(({ description }: { description?: ReactNode }) => <div>{description}</div>, {
    PRESENTED_IMAGE_SIMPLE: 'simple'
  }),
  Switch: (props: Record<string, unknown>) => <input checked={props.checked === true} readOnly type='checkbox' />,
  theme: { darkAlgorithm: vi.fn(), defaultAlgorithm: vi.fn() },
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>
}))
vi.mock(
  'jotai',
  () => ({
    useAtom: () => ['system', state.atomSetter],
    useAtomValue: () => 'system',
    useSetAtom: () => state.atomSetter
  })
)
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ i18n: { language: 'en', resolvedLanguage: 'en' }, t: (key: string) => key })
}))
vi.mock('swr', () => ({
  default: () => ({ data: state.config, mutate: async () => state.config }),
  useSWRConfig: () => ({ mutate: vi.fn(async () => state.config) })
}))
vi.mock('#~/api', () => ({ getConfig: vi.fn(), updateConfig: (...args: unknown[]) => state.updateConfig(...args) }))
vi.mock('@oneworks/utils/pinyin-search', () => ({
  matchesPinyinSearch: () => true,
  normalizePinyinSearchQuery: (query: string) => query.trim()
}))
vi.mock('#~/components/config/ConfigShortcutInput', () => ({ ShortcutInput: () => <input readOnly /> }))
vi.mock(
  '#~/components/config/ProjectThemeColorSettingsControls',
  () => ({ ProjectThemeColorSettingsControls: () => null })
)
vi.mock('#~/components/config/ThemeModeRadioGroup', () => ({ ThemeModeRadioGroup: () => null }))
vi.mock('#~/components/config/use-project-theme-preview-sources', () => ({ useProjectThemePreviewSources: () => ({}) }))
vi.mock('#~/components/launcher/LauncherExternalSessionsView', () => ({ LauncherExternalSessionsView: () => null }))
vi.mock('#~/components/mobile-aware-select/MobileAwareSelect', () => ({
  MobileAwareSelect: ({ onChange, value }: { onChange: (value: string) => void; value: string }) => (
    <button data-language={value} type='button' onClick={() => onChange('zh')}>language</button>
  )
}))
vi.mock(
  '#~/components/native-tabs',
  () => ({
    NativeTabs: ({ items, onChange }: { items: Array<{ key: string }>; onChange?: (key: string) => void }) => (
      <>
        {items.map(item => (
          <button data-launcher-section-id={item.key} key={item.key} type='button' onClick={() => onChange?.(item.key)}>
            {item.key}
          </button>
        ))}
      </>
    )
  })
)
vi.mock('#~/desktop/manager-runtime', () => ({
  connectDesktopManagerRuntimeIfAvailable: () => state.managerConnect()
}))
vi.mock('#~/i18n', () => ({
  appLanguageOptions: [{ label: 'English', searchKeywords: ['English'], shortLabel: 'EN', value: 'en' }],
  changeAppLanguage: vi.fn(),
  clearAppLanguageOverride: vi.fn(),
  getActiveAppLanguageOption: () => ({ label: 'English', searchKeywords: ['English'], shortLabel: 'EN', value: 'en' }),
  getDefaultAppLanguage: () => 'en',
  normalizeAppLanguage: (value: string | undefined) => value
}))
vi.mock('#~/plugins/PluginProvider', () => ({
  PluginProvider: ({ children, ...props }: { children: ReactNode }) => {
    state.pluginProviderProps = props
    return <>{children}</>
  }
}))
vi.mock('#~/plugins/plugin-context', () => ({ usePluginContext: () => ({ ready: true }) }))
vi.mock('#~/plugins/plugin-themes', () => ({ PluginThemeStyles: () => null, usePluginThemes: () => [] }))
vi.mock(
  '#~/notifications/NotificationProvider',
  () => ({ NotificationProvider: ({ children }: { children: ReactNode }) => <>{children}</> })
)
vi.mock(
  '#~/store',
  () => ({ normalizeThemeMode: (value: string) => value, themeAtom: {}, themePackAtom: {}, themePackSettingsAtom: {} })
)
vi.mock('#~/store/index.js', () => ({
  normalizeThemeMode: (value: string) => value,
  normalizeThemePack: (value: string) => value,
  themeAtom: {},
  themePackAtom: {},
  themePackSettingsAtom: {}
}))
vi.mock('#~/utils/keyboard-events', () => ({ deferImeCompositionEnd: vi.fn(), isImeCompositionKeyEvent: () => false }))
vi.mock(
  '#~/utils/shortcutUtils',
  () => ({ getDesktopShortcutFromEvent: vi.fn(), parseShortcut: () => ({ ctrlKey: true }) })
)
vi.mock('#~/routes/LauncherRoute', async () => {
  const { LauncherSettingsView } = await vi.importActual<typeof import('#~/components/launcher/LauncherSettingsView')>(
    '#~/components/launcher/LauncherSettingsView'
  )
  return {
    LauncherRoute: () => (
      <LauncherSettingsView
        isSearchInputComposing={() => false}
        query=''
        workspaceProjects={[]}
        onExternalSessionsImportComplete={vi.fn()}
        onKeyboardHintsChange={vi.fn()}
        onQueryChange={vi.fn()}
        onResetActionChange={action => {
          state.resetAction = action
        }}
        onSearchChromeChange={vi.fn()}
      />
    )
  }
})

const electronOnly = [
  'auto-update',
  'launch-at-login',
  'open-last-workspace-on-startup',
  'shortcut',
  'status-pin',
  'update-channel'
]
const shared = [
  'language',
  'hide-after-action',
  'current-project',
  'resource-search',
  'footer-hints',
  'text-size',
  'theme',
  'window-mode',
  'favorites',
  'app-icon'
]
const electronDesktopSettings = {
  autoUpdate: false,
  contextCapture: { allowApplications: [], denyApplications: [], enabled: false, overlayPlacement: 'auto' },
  launcherShortcut: '',
  launcherShortcutRegistered: false,
  openLastWorkspaceOnStartup: false,
  savedPasswordsAutoSignIn: false,
  savedPasswordsOfferToSave: false,
  savedPasswordsRequireAuth: false,
  updateChannel: 'stable'
} satisfies DesktopSettings
let container: HTMLDivElement
let root: Root

const setShell = (desktop?: Window['oneworksDesktop'], device?: Window['oneworksDeviceShell']) => {
  Object.defineProperty(window, 'oneworksDesktop', { configurable: true, value: desktop, writable: true })
  Object.defineProperty(window, 'oneworksDeviceShell', { configurable: true, value: device, writable: true })
}
const settingIds = () =>
  [...container.querySelectorAll<HTMLElement>('[data-launcher-setting-id]')].map(item => item.dataset.launcherSettingId)
const sectionIds = () =>
  [...container.querySelectorAll<HTMLElement>('[data-launcher-section-id]')].map(item => item.dataset.launcherSectionId)
const renderLauncher = async () => {
  await import('#~/routes/LauncherRoute')
  await act(async () => {
    root.render(<LauncherApp />)
    await Promise.resolve()
  })
  expect(sectionIds().length).toBeGreaterThan(0)
}
const renderStandalone = async () => {
  await act(async () =>
    root.render(
      <StandaloneRouteThemeProvider>
        <div />
      </StandaloneRouteThemeProvider>
    )
  )
  await act(async () => await Promise.resolve())
  await act(async () => await Promise.resolve())
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  vi.stubEnv('PROD', true)
  vi.stubGlobal('navigator', { serviceWorker: {} })
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn(() => ({ addEventListener: vi.fn(), matches: false, removeEventListener: vi.fn() })),
    writable: true
  })
  state.config = {
    sources: {
      global: { general: { interfaceLanguage: 'en', retained: 'keep' }, appearance: {}, desktop: {} },
      merged: { general: { interfaceLanguage: 'en', retained: 'keep' }, appearance: {}, desktop: {} }
    }
  }
  state.pluginProviderProps = undefined
  state.resetAction = undefined
  vi.clearAllMocks()
  state.managerConnect.mockResolvedValue(undefined)
  state.updateConfig.mockResolvedValue(undefined)
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  Reflect.deleteProperty(window, 'oneworksDesktop')
  Reflect.deleteProperty(window, 'oneworksDeviceShell')
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('launcher app shell runtime ownership', () => {
  it.each([
    ['Electron', { shellKind: 'electron' }, undefined, [...shared, ...electronOnly]],
    [
      'authoritative Android',
      {
        shellKind: 'electron',
        getManagerConnection: vi.fn(),
        getDesktopSettings: vi.fn(),
        updateDesktopSettings: vi.fn(),
        updateGlobalAppearanceConfig: vi.fn()
      },
      { shellKind: 'android' },
      shared
    ],
    [
      'partial bridge',
      {
        getManagerConnection: vi.fn(),
        getDesktopSettings: vi.fn(),
        updateDesktopSettings: vi.fn(),
        updateGlobalAppearanceConfig: vi.fn()
      },
      undefined,
      shared
    ],
    ['Web', undefined, undefined, [...shared, 'update-experience']],
    ['installed PWA', { shellKind: 'web' }, undefined, [...shared, 'update-experience']]
  ])('renders a unique no-query setting-ID bijection for %s', async (_label, desktop, device, expected) => {
    setShell(desktop, device)
    if (_label === 'installed PWA') {
      Object.defineProperty(window, 'matchMedia', {
        configurable: true,
        value: vi.fn(() => ({ addEventListener: vi.fn(), matches: true, removeEventListener: vi.fn() })),
        writable: true
      })
    }
    await renderLauncher()
    const perSectionIds = new Map<string, Array<string | undefined>>()
    for (const sectionId of sectionIds()) {
      await act(async () => container.querySelector<HTMLElement>(`[data-launcher-section-id="${sectionId}"]`)?.click())
      await act(async () => await Promise.resolve())
      const ids = settingIds()
      expect(ids).toHaveLength(new Set(ids).size)
      perSectionIds.set(sectionId ?? '', ids)
    }
    const ids = [...perSectionIds.values()].flat()
    expect(ids).toHaveLength(new Set(ids).size)
    expect(new Set(ids)).toEqual(new Set(expected))
    expect(state.pluginProviderProps?.deferUntilRuntimeServerBaseUrl).toBe(_label === 'Electron')
  })

  it.each([
    [
      'authoritative Android',
      {
        shellKind: 'electron',
        getDesktopSettings: vi.fn(),
        onDesktopSettingsChange: vi.fn()
      },
      { shellKind: 'android' },
      false
    ],
    [
      'partial bridge',
      {
        getDesktopSettings: vi.fn(),
        onDesktopSettingsChange: vi.fn()
      },
      undefined,
      false
    ],
    [
      'Electron',
      {
        shellKind: 'electron',
        getDesktopSettings: vi.fn(async () => electronDesktopSettings),
        onDesktopSettingsChange: vi.fn(() => vi.fn())
      },
      undefined,
      true
    ]
  ])('uses standalone desktop theme settings only for %s', async (_label, desktop, device, isElectron) => {
    setShell(desktop, device)
    await renderStandalone()
    expect(desktop.getDesktopSettings).toHaveBeenCalledTimes(isElectron ? 1 : 0)
    expect(desktop.onDesktopSettingsChange).toHaveBeenCalledTimes(isElectron ? 1 : 0)
    expect(state.managerConnect).toHaveBeenCalledTimes(isElectron ? 1 : 0)
    expect(state.pluginProviderProps?.deferUntilRuntimeServerBaseUrl).toBe(isElectron)
  })

  it.each([
    ['authoritative Android', {
      shellKind: 'electron',
      getDesktopSettings: vi.fn(),
      getManagerConnection: vi.fn(),
      updateDesktopSettings: vi.fn(),
      updateGlobalAppearanceConfig: vi.fn()
    }, { shellKind: 'android' }],
    ['partial bridge', {
      getDesktopSettings: vi.fn(),
      getManagerConnection: vi.fn(),
      updateDesktopSettings: vi.fn(),
      updateGlobalAppearanceConfig: vi.fn()
    }, undefined]
  ])('uses API config for %s language updates and reset without raw desktop calls', async (_label, desktop, device) => {
    setShell(desktop, device)
    await renderLauncher()
    expect(container.querySelector('[data-language]')?.getAttribute('data-language')).toBe('en')
    await act(async () => container.querySelector<HTMLElement>('[data-language]')?.click())
    await act(async () => await state.resetAction?.onClick())
    expect(state.updateConfig).toHaveBeenNthCalledWith(1, 'global', 'general', {
      interfaceLanguage: 'zh',
      retained: 'keep'
    })
    expect(state.updateConfig).toHaveBeenNthCalledWith(2, 'global', 'general', { retained: 'keep' }, {
      unsetPaths: [['interfaceLanguage']]
    })
    const rawDesktop = desktop as Window['oneworksDesktop']
    expect(rawDesktop?.getDesktopSettings).not.toHaveBeenCalled()
    expect(rawDesktop?.getManagerConnection).not.toHaveBeenCalled()
    expect(rawDesktop?.updateDesktopSettings).not.toHaveBeenCalled()
    expect(rawDesktop?.updateGlobalAppearanceConfig).not.toHaveBeenCalled()
  })
})
