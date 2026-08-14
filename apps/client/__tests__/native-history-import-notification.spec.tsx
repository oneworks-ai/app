// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { NativeHistoryImportResult } from '#~/api'
import type { UiNotificationInput } from '#~/notifications/notification-types'

const mocks = vi.hoisted(() => ({
  mutate: vi.fn(),
  navigate: vi.fn(),
  notifications: {
    close: vi.fn(),
    isSourceMuted: vi.fn(() => false),
    muteSource: vi.fn(),
    show: vi.fn((_input: UiNotificationInput) => ({ close: vi.fn(), id: 'notification-id' })),
    unmuteSource: vi.fn()
  },
  runNativeProjectHistoryImport: vi.fn()
}))

vi.mock('#~/api', () => ({
  getApiErrorMessage: (error: unknown) => String(error),
  runNativeProjectHistoryImport: mocks.runNativeProjectHistoryImport
}))

vi.mock('#~/notifications/NotificationProvider', () => ({
  useNotifications: () => mocks.notifications
}))

vi.mock('antd', () => ({
  App: {
    useApp: () => ({ message: { error: vi.fn() } })
  }
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      ({
        'nativeHistoryImport.aggregateLimitedDescription': `aggregate ${String(options?.count ?? '')} / ${
          String(options?.size ?? '')
        }`,
        'nativeHistoryImport.description': `imported ${String(options?.count ?? '')} ${
          String(options?.adapters ?? '')
        }`,
        'nativeHistoryImport.dismiss': 'Dismiss',
        'nativeHistoryImport.emptyDescription': 'No history',
        'nativeHistoryImport.emptyTitle': 'No history title',
        'nativeHistoryImport.failedDescription': 'Import failed',
        'nativeHistoryImport.incompleteTitle': 'Unread files',
        'nativeHistoryImport.open': 'Open',
        'nativeHistoryImport.perFileLimitedDescription': `per-file ${String(options?.count ?? '')} / ${
          String(options?.size ?? '')
        }`,
        'nativeHistoryImport.rejectedDescription': `rejected ${String(options?.count ?? '')}`,
        'nativeHistoryImport.retry': 'Retry import',
        'nativeHistoryImport.source': 'History import',
        'nativeHistoryImport.title': 'History imported'
      })[key] ?? key
  })
}))

vi.mock('react-router-dom', () => ({ useNavigate: () => mocks.navigate }))
vi.mock('swr', () => ({ useSWRConfig: () => ({ mutate: mocks.mutate }) }))

const result = (
  overrides: Partial<NativeHistoryImportResult> = {}
): NativeHistoryImportResult => ({
  aggregateLimitedBytes: 0,
  aggregateLimitedFiles: 0,
  importedEvents: 0,
  importedSessions: 0,
  matchedFiles: 0,
  perFileLimitedBytes: 0,
  perFileLimitedFiles: 0,
  rejectedFiles: 0,
  scannedFiles: 0,
  sessions: [],
  sizeLimitedBytes: 0,
  sizeLimitedFiles: 0,
  ...overrides
})

let container: HTMLDivElement
let root: Root
let runImport: (() => Promise<NativeHistoryImportResult | undefined>) | undefined

function Probe() {
  const { useNativeHistoryImportAction } = requireActionHook
  const action = useNativeHistoryImportAction()
  runImport = action.runImport
  return null
}

let requireActionHook: typeof import('#~/components/config/use-native-history-import-action')

const renderHook = async () => {
  requireActionHook = await import('#~/components/config/use-native-history-import-action')
  await act(async () => {
    root.render(<Probe />)
  })
}

describe('manual native history import diagnostics', () => {
  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
    runImport = undefined
    vi.clearAllMocks()
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
  })

  it.each([
    {
      diagnostic: result({ rejectedFiles: 2, scannedFiles: 2 }),
      expected: 'rejected 2',
      unexpected: 'No history'
    },
    {
      diagnostic: result({
        perFileLimitedBytes: 52_428_801,
        perFileLimitedFiles: 1,
        scannedFiles: 1,
        sizeLimitedBytes: 52_428_801,
        sizeLimitedFiles: 1
      }),
      expected: 'per-file 1 / 50.0 MiB',
      unexpected: 'aggregate'
    },
    {
      diagnostic: result({
        aggregateLimitedBytes: 1024,
        aggregateLimitedFiles: 1,
        scannedFiles: 1,
        sizeLimitedBytes: 1024,
        sizeLimitedFiles: 1
      }),
      expected: 'aggregate 1 / 1024 B',
      unexpected: 'per-file'
    }
  ])('shows an actionable all-skipped warning with $expected diagnostics', async ({
    diagnostic,
    expected,
    unexpected
  }) => {
    mocks.runNativeProjectHistoryImport.mockResolvedValue(diagnostic)
    await renderHook()

    await act(async () => {
      await runImport?.()
    })

    const notification = mocks.notifications.show.mock.calls[0]![0] as UiNotificationInput
    expect(notification).toEqual(expect.objectContaining({
      description: expect.stringContaining(expected),
      level: 'warning',
      title: 'Unread files'
    }))
    expect(notification.description).not.toContain(unexpected)
    expect(notification.actions).toEqual([
      expect.objectContaining({ id: 'retry', title: 'Retry import' })
    ])
  })

  it('retries an all-skipped manual import and preserves mixed-success diagnostics', async () => {
    const allSkipped = result({ rejectedFiles: 1, scannedFiles: 1 })
    const mixed = result({
      aggregateLimitedBytes: 42,
      aggregateLimitedFiles: 1,
      importedEvents: 2,
      importedSessions: 1,
      matchedFiles: 1,
      scannedFiles: 2,
      sessions: [{
        adapter: 'qwen-code',
        createdAt: 1,
        cwd: '/workspace',
        importedEvents: 2,
        sessionId: 'imported-qwen',
        sourcePath: '/history/qwen.jsonl',
        title: 'Imported Qwen',
        updatedAt: 2,
        workspaceCwd: '/workspace'
      }],
      sizeLimitedBytes: 42,
      sizeLimitedFiles: 1
    })
    mocks.runNativeProjectHistoryImport
      .mockResolvedValueOnce(allSkipped)
      .mockResolvedValueOnce(mixed)
    await renderHook()
    await act(async () => {
      await runImport?.()
    })

    const firstNotification = mocks.notifications.show.mock.calls[0]![0] as UiNotificationInput
    await act(async () => {
      firstNotification.actions?.[0]?.onClick?.({} as never)
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(mocks.runNativeProjectHistoryImport).toHaveBeenCalledTimes(2)
    const mixedNotification = mocks.notifications.show.mock.calls[1]![0] as UiNotificationInput
    expect(mixedNotification).toEqual(expect.objectContaining({
      description: expect.stringMatching(/imported 1 Qwen Code.*aggregate 1 \/ 42 B/u),
      level: 'warning',
      title: 'History imported'
    }))
    expect(mocks.mutate).toHaveBeenCalledWith('/api/sessions')
    expect(mocks.mutate).toHaveBeenCalledWith('/api/sessions/archived')
  })
})
