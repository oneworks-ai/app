// @vitest-environment happy-dom
/* eslint-disable max-lines -- mounted adapter-size and import-manager regressions share one stateful harness. */
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { SWRConfig } from 'swr'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type {
  NativeHistoryAdapter,
  NativeHistoryImportAdapterPreview,
  NativeHistoryImportPreviewCandidate,
  NativeHistoryImportPreviewResult,
  NativeHistoryImportResult
} from '#~/api'
import en from '#~/resources/locales/en.json'
import zh from '#~/resources/locales/zh.json'

const mocks = vi.hoisted(() => ({
  locale: 'zh' as 'en' | 'zh',
  modalConfirm: vi.fn(),
  previewNativeProjectHistory: vi.fn()
}))

vi.mock('#~/api', () => ({
  nativeHistoryAdapters: ['codex', 'claude-code', 'cline', 'cursor', 'goose', 'grok', 'qwen-code'],
  previewNativeProjectHistory: mocks.previewNativeProjectHistory
}))

vi.mock('@oneworks/components/route-layout', () => ({
  RouteContainerHeaderActionButton: ({
    item
  }: {
    item: {
      ariaDescribedBy?: string
      disabled?: boolean
      label: string
      loading?: boolean
      onSelect: () => void
    }
  }) => (
    <button
      aria-describedby={item.ariaDescribedBy}
      aria-label={item.label}
      data-loading={String(item.loading === true)}
      disabled={item.disabled}
      onClick={item.onSelect}
    />
  ),
  ShortcutTooltip: ({
    'aria-label': ariaLabel,
    children,
    className,
    tabIndex
  }: {
    'aria-label'?: string
    children: React.ReactNode
    className?: string
    tabIndex?: number
  }) => (
    <div aria-label={ariaLabel} className={className} tabIndex={tabIndex}>{children}</div>
  )
}))

vi.mock('antd', () => ({
  Alert: ({
    action,
    description,
    message
  }: {
    action?: React.ReactNode
    description?: React.ReactNode
    message?: React.ReactNode
  }) => (
    <div data-testid='diagnostic-alert'>{message}{description}{action}</div>
  ),
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
  InputNumber: ({ max, placeholder, value }: {
    max?: number
    placeholder?: string
    value?: number | null
  }) => (
    <div
      data-testid='adapter-size-input'
      data-max={max}
      data-placeholder={placeholder}
      data-value={value ?? ''}
    />
  ),
  Space: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  Switch: () => null,
  message: {}
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      ({
        'nativeHistoryImport.manager.emptyCandidates': '没有候选会话',
        'nativeHistoryImport.manager.emptyCandidatesAllProjects': '没有全局候选会话',
        'nativeHistoryImport.manager.emptySearchResults': '没有搜索结果',
        'nativeHistoryImport.manager.importOne': '导入',
        'nativeHistoryImport.manager.diagnosticAdapterUnavailable': 'Codex history unavailable',
        'nativeHistoryImport.manager.diagnosticUnsupportedSubtaskScope': 'Goose Subtasks are unsupported',
        'nativeHistoryImport.manager.diagnosticsTitle': 'History diagnostics',
        'nativeHistoryImport.manager.goosePreviewDisclosureTitle': 'How Goose preview works',
        'nativeHistoryImport.manager.goosePreviewDisclosure': 'Goose preview exports bounded message and tool content.',
        'nativeHistoryImport.manager.goosePreviewFailedTitle': 'Goose preview failed',
        'nativeHistoryImport.manager.goosePreviewFailedDescription':
          'Verify the Goose CLI path, version, and public session JSON, then retry.',
        'nativeHistoryImport.manager.retryPreview': 'Retry preview',
        'nativeHistoryImport.manager.autoSkippedManualAllowedSizePolicy':
          'Automatic import skips this item; manual Import remains available.',
        'nativeHistoryImport.manager.previewLoading': '正在加载',
        'nativeHistoryImport.manager.effectiveSizeLimit': `Effective: ${String(options?.size ?? '')}`,
        'nativeHistoryImport.manager.hardLimitMegabytes': '50',
        'nativeHistoryImport.manager.perFileLimitSkippedSummary': `Per-file ${String(options?.count ?? '')} / ${
          String(options?.size ?? '')
        }`,
        'nativeHistoryImport.manager.aggregateLimitSkippedSummary': `Aggregate ${String(options?.count ?? '')} / ${
          String(options?.size ?? '')
        }`,
        'nativeHistoryImport.manager.rejectedFilesSummary': `Rejected ${String(options?.count ?? '')}`,
        'nativeHistoryImport.manager.incompleteCandidates': `Incomplete ${String(options?.platform ?? '')}`,
        'nativeHistoryImport.manager.qwenSourceRootRemediation': mocks.locale === 'en'
          ? 'Check QWEN_RUNTIME_DIR, then QWEN_HOME, then ~/.qwen.'
          : '请检查 QWEN_RUNTIME_DIR，其次 QWEN_HOME，最后 ~/.qwen。',
        'nativeHistoryImport.manager.inheritGlobal': 'Inherit Global',
        'nativeHistoryImport.manager.invalidSizeLimitDescription': 'Invalid 0–50 MiB',
        'nativeHistoryImport.manager.platformDescriptions.codex': 'Codex source',
        'nativeHistoryImport.manager.platformDescriptions.qwen-code': mocks.locale === 'en'
          ? 'Qwen source: QWEN_RUNTIME_DIR, then QWEN_HOME, then ~/.qwen.'
          : 'Qwen 来源：QWEN_RUNTIME_DIR，其次 QWEN_HOME，最后 ~/.qwen。',
        'nativeHistoryImport.platforms.codex': 'Codex',
        'nativeHistoryImport.platforms.qwen-code': 'Qwen Code'
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
  aggregateLimitedBytes: 0,
  aggregateLimitedFiles: 0,
  candidates,
  diagnostics: [],
  hasMore: false,
  isComplete: true,
  largeFiles: candidates.filter(item => item.isLarge).length,
  largestFileBytes: Math.max(0, ...candidates.map(item => item.fileSizeBytes)),
  matchedFiles: candidates.length,
  perFileLimitedBytes: 0,
  perFileLimitedFiles: 0,
  projects: [{ path: '/projects/example', sessionCount: candidates.length }],
  rejectedFiles: 0,
  scannedFiles: candidates.length,
  sizeLimitedBytes: 0,
  sizeLimitedFiles: 0,
  totalBytes: candidates.reduce((sum, item) => sum + item.fileSizeBytes, 0),
  ...overrides
})

const previewResult = (
  preview: NativeHistoryImportAdapterPreview
): NativeHistoryImportPreviewResult => ({
  adapters: [preview],
  aggregateLimitedBytes: preview.aggregateLimitedBytes,
  aggregateLimitedFiles: preview.aggregateLimitedFiles,
  hasMore: preview.hasMore,
  isComplete: preview.isComplete,
  largeFileThresholdBytes: 50 * 1024 * 1024,
  largeFiles: preview.largeFiles,
  largestFileBytes: preview.largestFileBytes,
  matchedFiles: preview.matchedFiles,
  maxFileSizeBytes: 50 * 1024 * 1024,
  ...(preview.nextCursor == null ? {} : { nextCursor: preview.nextCursor }),
  perFileLimitedBytes: preview.perFileLimitedBytes,
  perFileLimitedFiles: preview.perFileLimitedFiles,
  rejectedFiles: preview.rejectedFiles,
  scannedFiles: preview.scannedFiles,
  sizeLimitedBytes: preview.sizeLimitedBytes,
  sizeLimitedFiles: preview.sizeLimitedFiles,
  totalBytes: preview.totalBytes
})

const importResult = (sourcePath: string): NativeHistoryImportResult => ({
  aggregateLimitedBytes: 0,
  aggregateLimitedFiles: 0,
  importedEvents: 3,
  importedSessions: 1,
  matchedFiles: 1,
  perFileLimitedBytes: 0,
  perFileLimitedFiles: 0,
  rejectedFiles: 0,
  scannedFiles: 1,
  sizeLimitedBytes: 0,
  sizeLimitedFiles: 0,
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
  runImport: (request: Record<string, unknown>) => Promise<NativeHistoryImportResult | undefined>,
  options: {
    adapter?: NativeHistoryAdapter
    config?: {
      maxFileSizeBytes?: number | null
      adapters?: Partial<Record<NativeHistoryAdapter, { maxFileSizeBytes?: number | null }>>
    }
    globalSizeLimit?: number | null
    showSettings?: boolean
  } = {}
) => {
  let toolbarActions: Array<{ key: string; onClick?: () => void }> = []
  const { ExternalSessionsAdapterTab } = await import(
    '#~/components/config/ExternalSessionsAdapterTab'
  )
  await act(async () => {
    root.render(
      <SWRConfig value={{ provider: () => new Map() }}>
        <ExternalSessionsAdapterTab
          adapter={options.adapter ?? 'codex'}
          config={options.config ?? (options.globalSizeLimit === undefined
            ? undefined
            : { maxFileSizeBytes: options.globalSizeLimit })}
          formatBytes={value => `${value} B`}
          formatTimestamp={value => String(value)}
          hasCurrentProjectScope={false}
          initialShowAllTime
          isActive
          isImporting={false}
          onAdapterConfigChange={() => undefined}
          onProjectPathsChange={() => undefined}
          onProjectScopeChange={() => undefined}
          onToolbarActionsChange={actions => {
            toolbarActions = actions
          }}
          projectPaths={[]}
          projectScope='all-projects'
          runImport={runImport}
          showSettings={options.showSettings ?? false}
          toolbarPlacement='external'
        />
      </SWRConfig>
    )
  })
  if (options.showSettings === true) {
    await flushEffects()
    if (container.querySelector('[data-testid="adapter-size-input"]') == null) {
      await act(async () => {
        toolbarActions.find(action => action.key === 'adapter-settings')?.onClick?.()
      })
    }
  }
}

describe('external sessions adapter import behavior', () => {
  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
    mocks.locale = 'zh'
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

  it('renders sanitized preview diagnostics instead of a false generic empty state only', async () => {
    mocks.previewNativeProjectHistory.mockResolvedValue({
      ...previewResult(adapterPreview([])),
      diagnostics: [{
        adapter: 'codex',
        code: 'adapter_unavailable',
        level: 'warning',
        message: 'internal message must not be rendered'
      }]
    })

    await renderAdapterTab(async () => undefined)
    await waitForText('History diagnostics')
    expect(container.textContent).toContain('Codex history unavailable')
    expect(container.textContent).not.toContain('internal message must not be rendered')
  })

  it('discloses Goose public export preview content and renders unsupported Subtasks distinctly', async () => {
    mocks.previewNativeProjectHistory.mockResolvedValue({
      ...previewResult(adapterPreview([], { adapter: 'goose' })),
      diagnostics: [{
        adapter: 'goose',
        code: 'unsupported_history_scope',
        level: 'warning',
        message: 'internal server diagnostic',
        sourceKind: 'subagent'
      }]
    })

    await renderAdapterTab(async () => undefined, { adapter: 'goose' })
    await waitForText('How Goose preview works')
    expect(container.textContent).toContain('Goose preview exports bounded message and tool content.')
    expect(container.textContent).toContain('Goose Subtasks are unsupported')
    expect(container.textContent).not.toContain('没有候选会话')
    expect(container.textContent).not.toContain('没有全局候选会话')
    expect(container.querySelector('[data-testid="empty"]')).toBeNull()
    expect(container.textContent).not.toContain('internal server diagnostic')
  })

  it('preserves the generic empty state for a supported Goose scope with no sessions', async () => {
    mocks.previewNativeProjectHistory.mockResolvedValue(
      previewResult(adapterPreview([], { adapter: 'goose' }))
    )

    await renderAdapterTab(async () => undefined, { adapter: 'goose' })
    await waitForText('没有全局候选会话')

    expect(container.textContent).not.toContain('Goose Subtasks are unsupported')
    expect(container.querySelector('[data-testid="empty"]')).not.toBeNull()
  })

  it('renders an actionable sanitized Goose failure for a rejected preview and retries', async () => {
    mocks.previewNativeProjectHistory
      .mockRejectedValueOnce(
        new Error('goose missing at /private/operator/home with token sk-raw-preview-secret')
      )
      .mockResolvedValueOnce(
        previewResult(adapterPreview([], { adapter: 'goose' }))
      )

    await renderAdapterTab(async () => undefined, { adapter: 'goose' })
    await waitForText('Goose preview failed')

    expect(container.textContent).toContain(
      'Verify the Goose CLI path, version, and public session JSON, then retry.'
    )
    expect(container.textContent).not.toContain('/private/operator/home')
    expect(container.textContent).not.toContain('sk-raw-preview-secret')
    expect(container.textContent).not.toContain('没有候选会话')
    expect(container.textContent).not.toContain('没有全局候选会话')
    expect(container.querySelector('[data-testid="empty"]')).toBeNull()

    const retryButton = Array.from(container.querySelectorAll('button'))
      .find(button => button.textContent === 'Retry preview')
    expect(retryButton).toBeDefined()
    await act(async () => {
      retryButton?.click()
      await Promise.resolve()
    })
    await waitForText('没有全局候选会话')

    expect(mocks.previewNativeProjectHistory).toHaveBeenCalledTimes(2)
    expect(container.textContent).not.toContain('Goose preview failed')
    expect(container.querySelector('[data-testid="empty"]')).not.toBeNull()
  })

  it('renders fulfilled Goose adapter_unavailable as failure instead of empty history', async () => {
    mocks.previewNativeProjectHistory.mockResolvedValue({
      ...previewResult(adapterPreview([], { adapter: 'goose' })),
      diagnostics: [{
        adapter: 'goose',
        code: 'adapter_unavailable',
        level: 'error',
        message: 'unsafe server path /private/goose and secret sk-server-secret'
      }]
    })

    await renderAdapterTab(async () => undefined, { adapter: 'goose' })
    await waitForText('Goose preview failed')

    expect(container.textContent).toContain(
      'Verify the Goose CLI path, version, and public session JSON, then retry.'
    )
    expect(container.textContent).not.toContain('unsafe server path')
    expect(container.textContent).not.toContain('sk-server-secret')
    expect(container.textContent).not.toContain('没有候选会话')
    expect(container.textContent).not.toContain('没有全局候选会话')
    expect(container.querySelector('[data-testid="empty"]')).toBeNull()
  })

  it('exposes the oversized Goose policy without hover and describes the keyboard import action', async () => {
    const oversized = { ...candidate('goose-cli://session/large', 'Large Goose', 100), adapter: 'goose' as const }
    mocks.previewNativeProjectHistory.mockResolvedValue(
      previewResult(adapterPreview([oversized], { adapter: 'goose' }))
    )
    const runImport = vi.fn().mockResolvedValue(undefined)

    await renderAdapterTab(runImport, { adapter: 'goose', globalSizeLimit: 1 })
    await waitForText('Large Goose')
    const policy = container.querySelector<HTMLElement>('.config-view__external-session-oversize-policy')
    expect(policy?.textContent).toBe('Automatic import skips this item; manual Import remains available.')
    expect(policy?.id).toBe('native-history-oversize-policy-goose-cli%3A%2F%2Fsession%2Flarge')
    const importButton = container.querySelector<HTMLButtonElement>('button[aria-label="导入"]')
    expect(importButton?.disabled).toBe(false)
    expect(importButton?.getAttribute('aria-describedby')).toBe(policy?.id)
    expect(document.getElementById(importButton!.getAttribute('aria-describedby')!)?.textContent).toBe(
      'Automatic import skips this item; manual Import remains available.'
    )
    const cwdDisclosure = container.querySelector<HTMLElement>('[aria-label="/projects/example"]')
    expect(cwdDisclosure?.tabIndex).toBe(0)
    cwdDisclosure?.focus()
    expect(document.activeElement).toBe(cwdDisclosure)
    importButton?.focus()
    expect(document.activeElement).toBe(importButton)
    policy?.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    expect(container.textContent).toContain('Automatic import skips this item; manual Import remains available.')
    await act(async () => {
      importButton?.click()
      await Promise.resolve()
    })
    expect(runImport).toHaveBeenCalledWith(expect.objectContaining({
      adapters: ['goose'],
      sourcePaths: ['goose-cli://session/large']
    }))
  })

  it('omits the oversize policy and description link for a normal-size candidate', async () => {
    const normal = { ...candidate('/history/normal.jsonl', 'Normal history', 10), adapter: 'goose' as const }
    mocks.previewNativeProjectHistory.mockResolvedValue(
      previewResult(adapterPreview([normal], { adapter: 'goose' }))
    )

    await renderAdapterTab(async () => undefined, { adapter: 'goose', globalSizeLimit: 100 })
    await waitForText('Normal history')

    expect(container.querySelector('.config-view__external-session-oversize-policy')).toBeNull()
    expect(container.textContent).not.toContain('Automatic import skips this item')
    expect(container.querySelector('button[aria-label="导入"]')?.hasAttribute('aria-describedby')).toBe(false)
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

  it('mounts truthful server hard-limit skip diagnostics while continuing the candidate list', async () => {
    const remainingCandidate = candidate('/history/remaining.jsonl', 'Remaining candidate', 20)
    mocks.previewNativeProjectHistory.mockResolvedValue(previewResult(adapterPreview(
      [remainingCandidate],
      {
        perFileLimitedBytes: 50 * 1024 * 1024 + 1,
        perFileLimitedFiles: 1,
        scannedFiles: 2,
        sizeLimitedBytes: 50 * 1024 * 1024 + 1,
        sizeLimitedFiles: 1
      }
    )))

    await renderAdapterTab(vi.fn())
    await waitForText('Per-file 1 / 52428801 B')

    expect(container.textContent).toContain(remainingCandidate.title)
  })

  it('does not misreport a rejected-only scan as no history', async () => {
    mocks.previewNativeProjectHistory.mockResolvedValue(previewResult(adapterPreview([], {
      rejectedFiles: 2,
      scannedFiles: 2
    })))

    await renderAdapterTab(vi.fn())
    await waitForText('Rejected 2')

    expect(container.textContent).toContain('Incomplete Codex')
    expect(container.textContent).not.toContain('没有全局候选会话')
    expect(container.querySelectorAll('[role="status"]')).toHaveLength(1)
  })

  it('does not misreport an aggregate-exhausted small file as per-file oversize or no history', async () => {
    mocks.previewNativeProjectHistory.mockResolvedValue(previewResult(adapterPreview([], {
      aggregateLimitedBytes: 1024,
      aggregateLimitedFiles: 1,
      scannedFiles: 1,
      sizeLimitedBytes: 1024,
      sizeLimitedFiles: 1
    })))
    await renderAdapterTab(vi.fn())
    await waitForText('Aggregate 1 / 1024 B')

    expect(container.textContent).toContain('Incomplete Codex')
    expect(container.textContent).not.toContain('Per-file')
    expect(container.textContent).not.toContain('没有全局候选会话')
  })

  it('mounts distinct diagnostics alongside mixed successful candidates', async () => {
    const remainingCandidate = candidate('/history/mixed.jsonl', 'Mixed success', 20)
    mocks.previewNativeProjectHistory.mockResolvedValue(previewResult(adapterPreview(
      [remainingCandidate],
      {
        aggregateLimitedBytes: 40,
        aggregateLimitedFiles: 1,
        perFileLimitedBytes: 60,
        perFileLimitedFiles: 1,
        rejectedFiles: 1,
        scannedFiles: 4,
        sizeLimitedBytes: 100,
        sizeLimitedFiles: 2
      }
    )))

    await renderAdapterTab(vi.fn())
    await waitForText('Mixed success')

    expect(container.textContent).toContain('Rejected 1')
    expect(container.textContent).toContain('Per-file 1 / 60 B')
    expect(container.textContent).toContain('Aggregate 1 / 40 B')
    expect(container.querySelectorAll('[role="status"]')).toHaveLength(3)
  })

  it('mounts the truthful Qwen source-root order and remediation in EN and ZH', async () => {
    const qwenPreview = adapterPreview([], {
      adapter: 'qwen-code',
      rejectedFiles: 1,
      scannedFiles: 1
    })
    mocks.previewNativeProjectHistory.mockResolvedValue(previewResult(qwenPreview))

    mocks.locale = 'en'
    await renderAdapterTab(vi.fn(), { adapter: 'qwen-code' })
    await waitForText('Qwen source: QWEN_RUNTIME_DIR, then QWEN_HOME, then ~/.qwen.')
    expect(container.textContent).toContain('Check QWEN_RUNTIME_DIR, then QWEN_HOME, then ~/.qwen.')

    mocks.locale = 'zh'
    await renderAdapterTab(vi.fn(), { adapter: 'qwen-code' })
    await waitForText('Qwen 来源：QWEN_RUNTIME_DIR，其次 QWEN_HOME，最后 ~/.qwen。')
    expect(container.textContent).toContain('请检查 QWEN_RUNTIME_DIR，其次 QWEN_HOME，最后 ~/.qwen。')
  })

  it('mounts truthful inherited, null override, exact, and invalid adapter size states', async () => {
    mocks.previewNativeProjectHistory.mockResolvedValue(previewResult(adapterPreview([])))
    await renderAdapterTab(vi.fn(), {
      config: { maxFileSizeBytes: 10 * 1024 * 1024 },
      showSettings: true
    })
    await waitForText('Effective: 10485760 B')
    let input = container.querySelector<HTMLElement>('[data-testid="adapter-size-input"]')
    expect(input?.dataset).toMatchObject({ max: '50', placeholder: 'Inherit Global' })

    await renderAdapterTab(vi.fn(), {
      config: {
        maxFileSizeBytes: 10 * 1024 * 1024,
        adapters: { codex: { maxFileSizeBytes: null } }
      },
      showSettings: true
    })
    await waitForText('Effective: 52428800 B')
    input = container.querySelector<HTMLElement>('[data-testid="adapter-size-input"]')
    expect(input?.dataset).toMatchObject({ max: '50', placeholder: '50' })

    await renderAdapterTab(vi.fn(), {
      config: { adapters: { codex: { maxFileSizeBytes: 50 * 1024 * 1024 } } },
      showSettings: true
    })
    await waitForText('Effective: 52428800 B')
    input = container.querySelector<HTMLElement>('[data-testid="adapter-size-input"]')
    expect(input?.dataset.value).toBe('50')

    await renderAdapterTab(vi.fn(), {
      config: { adapters: { codex: { maxFileSizeBytes: 50 * 1024 * 1024 + 1 } } },
      showSettings: true
    })
    await waitForText('Invalid 0–50 MiB')
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

  it('resolves null, inheritance, and per-adapter size limits to the truthful hard-cap policy', async () => {
    const {
      defaultNativeHistoryImportMaxFileSizeBytes,
      resolveNativeHistoryAdapterSizeLimit,
      resolveNativeHistoryGlobalSizeLimit
    } = await import('#~/components/config/external-sessions-panel-model')
    const belowLimit = 10 * 1024 * 1024
    const exactLimit = defaultNativeHistoryImportMaxFileSizeBytes

    expect(resolveNativeHistoryGlobalSizeLimit(undefined)).toBe(exactLimit)
    expect(resolveNativeHistoryGlobalSizeLimit({ maxFileSizeBytes: null })).toBe(exactLimit)
    expect(resolveNativeHistoryGlobalSizeLimit({ maxFileSizeBytes: belowLimit })).toBe(belowLimit)
    expect(resolveNativeHistoryAdapterSizeLimit({ maxFileSizeBytes: belowLimit }, 'cursor')).toBe(belowLimit)
    expect(resolveNativeHistoryAdapterSizeLimit({
      maxFileSizeBytes: belowLimit,
      adapters: { codex: { maxFileSizeBytes: null } }
    }, 'codex')).toBe(exactLimit)
    expect(resolveNativeHistoryAdapterSizeLimit({
      maxFileSizeBytes: exactLimit,
      adapters: { codex: { maxFileSizeBytes: belowLimit } }
    }, 'codex')).toBe(belowLimit)
  })
})

describe('external sessions Goose policy copy', () => {
  it('states the public-export preview and automatic-vs-manual size policy in both locales', () => {
    expect(en.nativeHistoryImport.manager.goosePreviewDisclosure).toContain('public session export command')
    expect(en.nativeHistoryImport.manager.goosePreviewDisclosure).toContain('message and tool content')
    expect(en.nativeHistoryImport.manager.autoSkippedManualAllowedSizePolicy).toContain('Automatic import skips')
    expect(en.nativeHistoryImport.manager.autoSkippedManualAllowedSizePolicy).toContain(
      'manual Import remains available'
    )
    expect(en.nativeHistoryImport.manager.diagnosticUnsupportedSubtaskScope).toContain(
      'not an empty-history result'
    )
    expect(en.nativeHistoryImport.manager.goosePreviewFailedDescription).toContain('path and version')
    expect(en.nativeHistoryImport.manager.goosePreviewFailedDescription).toContain('valid JSON')
    expect(en.nativeHistoryImport.manager.retryPreview).toBe('Retry preview')
    expect(zh.nativeHistoryImport.manager.goosePreviewDisclosure).toContain('公开的 session export 命令')
    expect(zh.nativeHistoryImport.manager.goosePreviewDisclosure).toContain('消息和工具内容')
    expect(zh.nativeHistoryImport.manager.autoSkippedManualAllowedSizePolicy).toContain('自动导入会跳过')
    expect(zh.nativeHistoryImport.manager.autoSkippedManualAllowedSizePolicy).toContain('仍可手动“导入”')
    expect(zh.nativeHistoryImport.manager.diagnosticUnsupportedSubtaskScope).toContain('不表示历史为空')
    expect(zh.nativeHistoryImport.manager.goosePreviewFailedDescription).toContain('路径与版本')
    expect(zh.nativeHistoryImport.manager.goosePreviewFailedDescription).toContain('有效 JSON')
    expect(zh.nativeHistoryImport.manager.retryPreview).toBe('重试预览')
  })
})
