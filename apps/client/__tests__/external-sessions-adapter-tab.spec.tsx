// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { SWRConfig } from 'swr'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type {
  NativeHistoryImportAdapterPreview,
  NativeHistoryImportPreviewCandidate,
  NativeHistoryImportPreviewResult,
  NativeHistoryImportResult
} from '#~/api'

const mocks = vi.hoisted(() => ({
  modalConfirm: vi.fn(),
  previewNativeProjectHistory: vi.fn()
}))

vi.mock('#~/api', () => ({
  nativeHistoryAdapters: ['codex', 'claude-code'],
  previewNativeProjectHistory: mocks.previewNativeProjectHistory
}))

vi.mock('@oneworks/components/route-layout', () => ({
  RouteContainerHeaderActionButton: ({
    item
  }: {
    item: {
      disabled?: boolean
      label: string
      loading?: boolean
      onSelect: () => void
    }
  }) => (
    <button
      aria-label={item.label}
      data-loading={String(item.loading === true)}
      disabled={item.disabled}
      onClick={item.onSelect}
    />
  ),
  ShortcutTooltip: ({ children }: { children: React.ReactNode }) => children
}))

vi.mock('antd', () => ({
  App: {
    useApp: () => ({
      modal: {
        confirm: mocks.modalConfirm
      }
    })
  },
  Button: ({
    children,
    disabled,
    onClick
  }: {
    children?: React.ReactNode
    disabled?: boolean
    onClick?: () => void
  }) => (
    <button disabled={disabled} onClick={onClick}>
      {children}
    </button>
  ),
  DatePicker: {
    RangePicker: () => null
  },
  Empty: ({ description }: { description?: React.ReactNode }) => (
    <div data-testid='empty'>{description}</div>
  ),
  InputNumber: () => null,
  Space: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  Switch: () => null,
  message: {}
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) =>
      ({
        'nativeHistoryImport.manager.emptyCandidates': '没有候选会话',
        'nativeHistoryImport.manager.emptyCandidatesAllProjects': '没有全局候选会话',
        'nativeHistoryImport.manager.emptySearchResults': '没有搜索结果',
        'nativeHistoryImport.manager.importOne': '导入',
        'nativeHistoryImport.manager.previewLoading': '正在加载',
        'nativeHistoryImport.platforms.codex': 'Codex'
      })[key] ?? key
  })
}))

vi.mock('#~/components/action-search-toolbar/ActionSearchToolbar', () => ({
  ActionSearchToolbar: () => null
}))

vi.mock('#~/components/mobile-aware-select/MobileAwareSelect', () => ({
  MobileAwareSelect: () => null
}))

vi.mock('#~/utils/copy', () => ({
  copyTextWithFeedback: vi.fn()
}))

vi.mock('#~/components/config/ConfigFieldRow', () => ({
  FieldRow: ({
    children,
    description,
    title
  }: {
    children?: React.ReactNode
    description?: React.ReactNode
    title?: React.ReactNode
  }) => (
    <div data-testid='candidate-row'>
      <div>{title}</div>
      <div>{description}</div>
      <div>{children}</div>
    </div>
  )
}))

const candidate = (
  sourcePath: string,
  title: string,
  fileSizeBytes: number,
  isLarge = false
): NativeHistoryImportPreviewCandidate => ({
  adapter: 'codex',
  createdAt: 100,
  cwd: '/projects/example',
  fileSizeBytes,
  isArchived: false,
  isImported: false,
  isLarge,
  isPinned: false,
  nativeSessionId: `native-${title}`,
  sourcePath,
  threadSource: 'user',
  title,
  updatedAt: 200
})

const adapterPreview = (
  candidates: NativeHistoryImportPreviewCandidate[],
  overrides: Partial<NativeHistoryImportAdapterPreview> = {}
): NativeHistoryImportAdapterPreview => ({
  adapter: 'codex',
  candidates,
  hasMore: false,
  isComplete: true,
  largeFiles: candidates.filter(item => item.isLarge).length,
  largestFileBytes: Math.max(0, ...candidates.map(item => item.fileSizeBytes)),
  matchedFiles: candidates.length,
  projects: [{ path: '/projects/example', sessionCount: candidates.length }],
  scannedFiles: candidates.length,
  totalBytes: candidates.reduce((sum, item) => sum + item.fileSizeBytes, 0),
  ...overrides
})

const previewResult = (
  preview: NativeHistoryImportAdapterPreview
): NativeHistoryImportPreviewResult => ({
  adapters: [preview],
  hasMore: preview.hasMore,
  isComplete: preview.isComplete,
  largeFileThresholdBytes: 50 * 1024 * 1024,
  largeFiles: preview.largeFiles,
  largestFileBytes: preview.largestFileBytes,
  matchedFiles: preview.matchedFiles,
  ...(preview.nextCursor == null ? {} : { nextCursor: preview.nextCursor }),
  scannedFiles: preview.scannedFiles,
  totalBytes: preview.totalBytes
})

const importResult = (sourcePath: string): NativeHistoryImportResult => ({
  importedEvents: 3,
  importedSessions: 1,
  matchedFiles: 1,
  scannedFiles: 1,
  sessions: [{
    adapter: 'codex',
    createdAt: 100,
    cwd: '/projects/example',
    importedEvents: 3,
    sessionId: 'session-1',
    sourcePath,
    title: 'Imported session',
    updatedAt: 200,
    workspaceCwd: '/projects/example'
  }]
})

let container: HTMLDivElement
let root: Root

const flushEffects = async () => {
  await act(async () => {
    await new Promise(resolve => setTimeout(resolve, 0))
  })
}

const waitForText = async (text: string) => {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (container.textContent?.includes(text) === true) {
      return
    }
    await flushEffects()
  }
  throw new Error(`Timed out waiting for text: ${text}`)
}

const renderAdapterTab = async (
  runImport: (request: Record<string, unknown>) => Promise<NativeHistoryImportResult | undefined>
) => {
  const { ExternalSessionsAdapterTab } = await import(
    '#~/components/config/ExternalSessionsAdapterTab'
  )
  await act(async () => {
    root.render(
      <SWRConfig value={{ provider: () => new Map() }}>
        <ExternalSessionsAdapterTab
          adapter='codex'
          formatBytes={value => `${value} B`}
          formatTimestamp={value => String(value)}
          hasCurrentProjectScope={false}
          initialShowAllTime
          isActive
          isImporting={false}
          onAdapterConfigChange={() => undefined}
          onProjectPathsChange={() => undefined}
          onProjectScopeChange={() => undefined}
          projectPaths={[]}
          projectScope='all-projects'
          runImport={runImport}
          showSettings={false}
          toolbarPlacement='external'
        />
      </SWRConfig>
    )
  })
}

describe('external sessions adapter import behavior', () => {
  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
    mocks.modalConfirm.mockReset()
    mocks.previewNativeProjectHistory.mockReset()
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
  })

  it('describes an empty all-project preview with global project scope', async () => {
    mocks.previewNativeProjectHistory.mockResolvedValue(
      previewResult(adapterPreview([]))
    )

    await renderAdapterTab(vi.fn())
    await waitForText('没有全局候选会话')

    expect(container.textContent).not.toContain('没有候选会话')
  })

  it('removes only the imported row before a slow background preview finishes', async () => {
    const importedCandidate = candidate('/history/imported.jsonl', 'Imported candidate', 10)
    const remainingCandidate = candidate('/history/remaining.jsonl', 'Remaining candidate', 20)
    let resolveBackgroundPreview: ((value: NativeHistoryImportPreviewResult) => void) | undefined
    mocks.previewNativeProjectHistory
      .mockResolvedValueOnce(previewResult(adapterPreview([
        importedCandidate,
        remainingCandidate
      ])))
      .mockReturnValueOnce(
        new Promise((resolve) => {
          resolveBackgroundPreview = resolve
        })
      )
    const runImport = vi.fn().mockResolvedValue(importResult(importedCandidate.sourcePath))

    await renderAdapterTab(runImport)
    await waitForText(importedCandidate.title)

    const importButtons = container.querySelectorAll<HTMLButtonElement>('button[aria-label="导入"]')
    expect(importButtons).toHaveLength(2)
    await act(async () => {
      importButtons[0]!.click()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(runImport).toHaveBeenCalledWith(expect.objectContaining({
      adapters: ['codex'],
      projectScope: 'all-projects',
      sourcePaths: [importedCandidate.sourcePath],
      threadScope: 'user',
      timeSort: 'activity'
    }))
    expect(container.textContent).not.toContain(importedCandidate.title)
    expect(container.textContent).toContain(remainingCandidate.title)
    expect(mocks.previewNativeProjectHistory).toHaveBeenCalledTimes(2)

    resolveBackgroundPreview?.(previewResult(adapterPreview([remainingCandidate])))
    await flushEffects()

    expect(container.textContent).not.toContain(importedCandidate.title)
    expect(container.textContent).toContain(remainingCandidate.title)
  })

  it('keeps the row when the import does not return a result', async () => {
    const failedCandidate = candidate('/history/failed.jsonl', 'Failed candidate', 10)
    mocks.previewNativeProjectHistory.mockResolvedValue(
      previewResult(adapterPreview([failedCandidate]))
    )
    const runImport = vi.fn().mockResolvedValue(undefined)

    await renderAdapterTab(runImport)
    await waitForText(failedCandidate.title)

    const importButton = container.querySelector<HTMLButtonElement>('button[aria-label="导入"]')
    await act(async () => {
      importButton?.click()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(runImport).toHaveBeenCalledTimes(1)
    expect(container.textContent).toContain(failedCandidate.title)
    expect(mocks.previewNativeProjectHistory).toHaveBeenCalledTimes(1)
  })
})

describe('external sessions preview cache updates', () => {
  it('preserves pagination metadata and recomputes every page summary', async () => {
    const { removeImportedNativeHistoryPreviewCandidates } = await import(
      '#~/components/config/external-sessions-panel-model'
    )
    const importedCandidate = candidate('/history/imported.jsonl', 'Imported', 100, true)
    const firstRemaining = candidate('/history/first.jsonl', 'First', 20)
    const secondRemaining = candidate('/history/second.jsonl', 'Second', 80, true)
    const pages = [
      adapterPreview([importedCandidate, firstRemaining], {
        hasMore: true,
        isComplete: false,
        nextCursor: 'page-2',
        scannedFiles: 50
      }),
      adapterPreview([secondRemaining], {
        scannedFiles: 75
      }),
      undefined
    ]

    const updatedPages = removeImportedNativeHistoryPreviewCandidates(
      pages,
      new Set([importedCandidate.sourcePath])
    )

    expect(updatedPages?.[0]).toMatchObject({
      candidates: [firstRemaining],
      hasMore: true,
      isComplete: false,
      largeFiles: 0,
      largestFileBytes: 20,
      matchedFiles: 1,
      nextCursor: 'page-2',
      scannedFiles: 50,
      totalBytes: 20
    })
    expect(updatedPages?.[1]).toMatchObject({
      candidates: [secondRemaining],
      largeFiles: 1,
      largestFileBytes: 80,
      matchedFiles: 1,
      scannedFiles: 75,
      totalBytes: 80
    })
    expect(updatedPages?.[2]).toBeUndefined()
  })
})
