// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  inputProps: [] as Array<Record<string, unknown>>,
  onConfigChange: vi.fn()
}))

vi.mock('#~/api', () => ({
  nativeHistoryAdapters: ['codex', 'cursor']
}))

vi.mock('antd', () => ({
  InputNumber: (props: Record<string, unknown>) => {
    mocks.inputProps.push(props)
    return <div data-testid='size-input' />
  },
  Switch: () => null
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    i18n: { language: 'en', resolvedLanguage: 'en' },
    t: (key: string) =>
      ({
        'nativeHistoryImport.manager.globalAutoImportDescription': 'Automatic import default',
        'nativeHistoryImport.manager.globalAutoImportTitle': 'Automatic Import',
        'nativeHistoryImport.manager.globalSizeLimitDescription': '50 MiB hard maximum',
        'nativeHistoryImport.manager.globalSizeLimitTitle': 'Automatic Import Size Limit',
        'nativeHistoryImport.manager.hardLimitMegabytes': '50',
        'nativeHistoryImport.manager.invalidSizeLimitDescription': 'Invalid 0–50 MiB'
      })[key] ?? key
  })
}))

vi.mock('#~/components/native-tabs', () => ({
  NativeTabs: () => null
}))

vi.mock('#~/hooks/use-resolved-theme-mode', () => ({
  useResolvedThemeMode: () => ({ resolvedThemeMode: 'light' })
}))

vi.mock('#~/resources/adapters', () => ({
  getAdapterDisplay: () => ({}),
  resolveAdapterDisplayIcon: () => undefined
}))

vi.mock('#~/runtime-config', () => ({
  getRuntimeWorkspaceId: () => 'workspace'
}))

vi.mock('#~/components/config/ConfigFieldRow', () => ({
  FieldRow: ({ children, description, title }: {
    children?: React.ReactNode
    description?: React.ReactNode
    title?: React.ReactNode
  }) =>
    <div>
      <span>{title}</span>
      <span>{description}</span>
      {children}
    </div>
}))

vi.mock('#~/components/config/ConfigSectionFrame', () => ({
  ConfigSectionFrame: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>
}))

vi.mock('#~/components/config/ExternalSessionsAdapterTab', () => ({
  ExternalSessionsAdapterTab: () => null
}))

vi.mock('#~/components/config/use-native-history-import-action', () => ({
  useNativeHistoryImportAction: () => ({ isImporting: false, runImport: vi.fn() })
}))

let container: HTMLDivElement
let root: Root

const renderPanel = async (config?: {
  maxFileSizeBytes?: number | null
}) => {
  const { ExternalSessionsPanel } = await import('#~/components/config/ExternalSessionsPanel')
  mocks.inputProps.length = 0
  await act(async () => {
    root.render(
      <ExternalSessionsPanel
        activeAdapter='codex'
        config={config}
        onActiveAdapterChange={() => undefined}
        onConfigChange={mocks.onConfigChange}
      />
    )
  })
  return mocks.inputProps.at(-1)!
}

describe('external sessions mounted size policy', () => {
  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
    mocks.onConfigChange.mockReset()
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
  })

  it('shows null as the 50 MiB default, preserves configured values, and rejects above-limit edits', async () => {
    const hardLimitBytes = 50 * 1024 * 1024
    let input = await renderPanel({ maxFileSizeBytes: null })
    expect(input).toMatchObject({ max: 50, min: 0, placeholder: '50', value: null })
    expect(container.textContent).toContain('50 MiB hard maximum')

    input = await renderPanel({ maxFileSizeBytes: 10 * 1024 * 1024 })
    expect(input.value).toBe(10)
    input = await renderPanel({ maxFileSizeBytes: hardLimitBytes })
    expect(input.value).toBe(50)

    input = await renderPanel({ maxFileSizeBytes: hardLimitBytes + 1 })
    expect(input.value).toBeGreaterThan(50)
    expect(container.textContent).toContain('Invalid 0–50 MiB')

    await act(async () => {
      ;(input.onChange as (value: number) => void)(51)
    })
    expect(mocks.onConfigChange).not.toHaveBeenCalled()
  })
})
