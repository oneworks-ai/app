import './SessionCreationProgressBanner.scss'

import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { SessionCreationProgressEvent, SessionCreationProgressStatus } from '@oneworks/types'

interface SessionCreationProgressOutputChunk {
  stream: 'stdout' | 'stderr'
  output: string
}

type SessionCreationProgressDisplayItem = SessionCreationProgressEvent & {
  outputChunks: SessionCreationProgressOutputChunk[]
}

interface SessionCreationProgressOutputSummary {
  hasLongOutput: boolean
  label: string
}

const OUTPUT_EXPAND_THRESHOLD_CHARS = 900
const OUTPUT_EXPAND_THRESHOLD_LINES = 8

const getProgressItemKey = (progress: SessionCreationProgressEvent) => {
  if (progress.scriptPath != null && progress.scriptPath.trim() !== '') {
    return `script:${progress.scriptPath}`
  }
  if (progress.step === 'worktree_creating' || progress.step === 'worktree_created') {
    return 'worktree:create'
  }
  if (progress.step === 'environment_resolving' || progress.step === 'environment_skipped') {
    return 'environment'
  }
  if (progress.step === 'environment_script_output' && progress.scriptFileName != null) {
    return `script:${progress.scriptFileName}`
  }
  return progress.step
}

const hasWorktreeCreated = (progress: SessionCreationProgressEvent[]) => (
  progress.some(item => item.step === 'worktree_created' && item.status === 'success')
)

const hasEnvironmentResolved = (progress: SessionCreationProgressEvent[]) => (
  progress.some(item => (
    item.step === 'environment_script_running' ||
    item.step === 'environment_script_succeeded' ||
    item.step === 'environment_script_failed' ||
    item.step === 'environment_skipped'
  ))
)

const normalizeProgressItem = (
  item: SessionCreationProgressDisplayItem,
  progress: SessionCreationProgressEvent[]
): SessionCreationProgressDisplayItem => {
  if (item.step === 'worktree_preparing' && item.status === 'running' && hasWorktreeCreated(progress)) {
    return { ...item, status: 'success' }
  }

  if (item.step === 'environment_resolving' && item.status === 'running' && hasEnvironmentResolved(progress)) {
    return { ...item, status: 'success' }
  }

  return item
}

const getStatusIcon = (status: SessionCreationProgressStatus) => {
  switch (status) {
    case 'success':
      return 'check_circle'
    case 'error':
      return 'error'
    case 'skipped':
      return 'remove_circle'
    default:
      return 'sync'
  }
}

const getProgressLabelKey = (progress: SessionCreationProgressEvent) => {
  switch (progress.step) {
    case 'worktree_preparing':
      return 'chat.sessionCreationProgress.worktreePreparing'
    case 'worktree_creating':
      return 'chat.sessionCreationProgress.worktreeCreating'
    case 'worktree_created':
      return 'chat.sessionCreationProgress.worktreeCreated'
    case 'environment_resolving':
      return 'chat.sessionCreationProgress.environmentResolving'
    case 'environment_script_running':
      return 'chat.sessionCreationProgress.environmentScriptRunning'
    case 'environment_script_output':
      return 'chat.sessionCreationProgress.environmentScriptRunning'
    case 'environment_script_succeeded':
      return 'chat.sessionCreationProgress.environmentScriptSucceeded'
    case 'environment_script_failed':
      return 'chat.sessionCreationProgress.environmentScriptFailed'
    case 'environment_skipped':
      return 'chat.sessionCreationProgress.environmentSkipped'
    case 'workspace_ready':
      return 'chat.sessionCreationProgress.workspaceReady'
    case 'workspace_failed':
      return 'chat.sessionCreationProgress.workspaceFailed'
  }
}

const getProgressDetail = (progress: SessionCreationProgressEvent) => (
  progress.scriptFileName ??
    progress.environmentId ??
    progress.worktreePath ??
    progress.message
)

const getProgressOutputChunk = (
  progress: SessionCreationProgressEvent
): SessionCreationProgressOutputChunk | undefined => {
  if (
    progress.stream == null ||
    progress.output == null ||
    progress.output === ''
  ) {
    return undefined
  }

  return {
    stream: progress.stream,
    output: progress.output
  }
}

const getOutputText = (chunks: SessionCreationProgressOutputChunk[]) => chunks.map(chunk => chunk.output).join('')

const getOutputLineCount = (output: string) => {
  if (output === '') {
    return 0
  }

  const normalized = output.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  const withoutTrailingNewline = normalized.endsWith('\n') ? normalized.slice(0, -1) : normalized
  return withoutTrailingNewline === '' ? 1 : withoutTrailingNewline.split('\n').length
}

const formatOutputSize = (output: string) => {
  const size = new TextEncoder().encode(output).length
  if (size < 1024) {
    return `${size} B`
  }

  const kb = size / 1024
  if (kb < 1024) {
    return `${kb < 10 ? kb.toFixed(1) : Math.round(kb)} KB`
  }

  const mb = kb / 1024
  return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`
}

const getOutputSummary = (
  chunks: SessionCreationProgressOutputChunk[],
  t: (key: string, values?: Record<string, unknown>) => string
): SessionCreationProgressOutputSummary | undefined => {
  if (chunks.length === 0) {
    return undefined
  }

  const outputText = getOutputText(chunks)
  const lineCount = getOutputLineCount(outputText)
  const outputSize = formatOutputSize(outputText)
  return {
    hasLongOutput: lineCount > OUTPUT_EXPAND_THRESHOLD_LINES || outputText.length > OUTPUT_EXPAND_THRESHOLD_CHARS,
    label: t('chat.sessionCreationProgress.outputSummary', {
      lines: lineCount,
      size: outputSize
    })
  }
}

const createDisplayItem = (
  progress: SessionCreationProgressEvent,
  outputChunks: SessionCreationProgressOutputChunk[]
): SessionCreationProgressDisplayItem => ({
  ...progress,
  step: progress.step === 'environment_script_output' ? 'environment_script_running' : progress.step,
  outputChunks
})

function SessionCreationProgressOutputLog({
  detail,
  item,
  outputId,
  summary
}: {
  detail?: string
  item: SessionCreationProgressDisplayItem
  outputId: string
  summary: SessionCreationProgressOutputSummary
}) {
  const { t } = useTranslation()
  const outputRef = useRef<HTMLSpanElement>(null)
  const [isHeightExpanded, setIsHeightExpanded] = useState(false)
  const [shouldFollowOutput, setShouldFollowOutput] = useState(true)
  const outputText = useMemo(() => getOutputText(item.outputChunks), [item.outputChunks])
  const outputLabel = t('chat.sessionCreationProgress.outputLabel', {
    script: detail ?? t(getProgressLabelKey(item))
  })
  const hasToolbar = !shouldFollowOutput || summary.hasLongOutput

  useEffect(() => {
    if (!shouldFollowOutput || outputRef.current == null) {
      return
    }

    outputRef.current.scrollTop = outputRef.current.scrollHeight
  }, [isHeightExpanded, outputText, shouldFollowOutput])

  const scrollToLatestOutput = () => {
    const output = outputRef.current
    if (output == null) {
      return
    }

    output.scrollTop = output.scrollHeight
    setShouldFollowOutput(true)
  }

  return (
    <span
      id={outputId}
      className={`session-creation-progress__step-output ${isHeightExpanded ? 'is-expanded' : ''}`}
      aria-label={outputLabel}
    >
      {hasToolbar && (
        <span className='session-creation-progress__output-toolbar'>
          {!shouldFollowOutput && (
            <button
              type='button'
              className='session-creation-progress__output-action'
              aria-label={t('chat.sessionCreationProgress.outputFollow')}
              title={t('chat.sessionCreationProgress.outputFollow')}
              onClick={scrollToLatestOutput}
            >
              <span className='material-symbols-rounded'>vertical_align_bottom</span>
            </button>
          )}
          {summary.hasLongOutput && (
            <button
              type='button'
              className='session-creation-progress__output-action'
              aria-label={t(
                isHeightExpanded
                  ? 'chat.sessionCreationProgress.outputRestore'
                  : 'chat.sessionCreationProgress.outputMaximize'
              )}
              title={t(
                isHeightExpanded
                  ? 'chat.sessionCreationProgress.outputRestore'
                  : 'chat.sessionCreationProgress.outputMaximize'
              )}
              onClick={() => setIsHeightExpanded(current => !current)}
            >
              <span className='material-symbols-rounded'>
                {isHeightExpanded ? 'close_fullscreen' : 'open_in_full'}
              </span>
            </button>
          )}
        </span>
      )}
      <span
        ref={outputRef}
        className='session-creation-progress__output-body'
        onScroll={() => {
          const output = outputRef.current
          if (output == null) {
            return
          }

          const distanceToBottom = output.scrollHeight - output.scrollTop - output.clientHeight
          setShouldFollowOutput(distanceToBottom < 24)
        }}
      >
        {item.outputChunks.map((chunk, index) => (
          <span
            key={`${chunk.stream}:${index}`}
            className={`session-creation-progress__output-line session-creation-progress__output-line--${chunk.stream}`}
          >
            {chunk.output}
          </span>
        ))}
      </span>
    </span>
  )
}

function SessionCreationProgressStep({
  item
}: {
  item: SessionCreationProgressDisplayItem
}) {
  const { t } = useTranslation()
  const outputId = useId()
  const [isOutputOpen, setIsOutputOpen] = useState(false)
  const detail = getProgressDetail(item)
  const outputSummary = getOutputSummary(item.outputChunks, t)
  const hasOutput = outputSummary != null
  const showDetailRow = detail != null && detail.trim() !== '' || hasOutput

  return (
    <div
      className={`session-creation-progress__step session-creation-progress__step--${item.status}`}
    >
      <span className='session-creation-progress__step-icon material-symbols-rounded'>
        {getStatusIcon(item.status)}
      </span>
      <span className='session-creation-progress__step-copy'>
        <span className='session-creation-progress__step-title'>
          {t(getProgressLabelKey(item))}
        </span>
        {showDetailRow && (
          <span className='session-creation-progress__step-detail-row'>
            {hasOutput && (
              <button
                type='button'
                className='session-creation-progress__output-toggle'
                aria-controls={outputId}
                aria-expanded={isOutputOpen}
                aria-label={t(
                  isOutputOpen
                    ? 'chat.sessionCreationProgress.outputCollapse'
                    : 'chat.sessionCreationProgress.outputExpand'
                )}
                title={t(
                  isOutputOpen
                    ? 'chat.sessionCreationProgress.outputCollapse'
                    : 'chat.sessionCreationProgress.outputExpand'
                )}
                onClick={() => setIsOutputOpen(current => !current)}
              >
                <span className='material-symbols-rounded'>{isOutputOpen ? 'expand_more' : 'chevron_right'}</span>
              </button>
            )}
            {detail != null && detail.trim() !== '' && (
              <span className='session-creation-progress__step-detail' title={detail}>
                {detail}
              </span>
            )}
            {outputSummary != null && (
              <span className='session-creation-progress__step-output-summary'>{outputSummary.label}</span>
            )}
          </span>
        )}
        {isOutputOpen && outputSummary != null && (
          <SessionCreationProgressOutputLog detail={detail} item={item} outputId={outputId} summary={outputSummary} />
        )}
      </span>
    </div>
  )
}

export function SessionCreationProgressBanner({
  collapseWhenComplete = false,
  progress
}: {
  collapseWhenComplete?: boolean
  progress: SessionCreationProgressEvent[]
}) {
  const { t } = useTranslation()
  const stepsId = useId()
  const progressItems = useMemo(() => {
    const items = new Map<string, SessionCreationProgressDisplayItem>()
    for (const item of progress) {
      const key = getProgressItemKey(item)
      const existing = items.get(key)
      const outputChunk = getProgressOutputChunk(item)
      const existingOutputChunks = existing?.outputChunks ?? []
      const outputChunks = outputChunk == null
        ? existingOutputChunks
        : [...existingOutputChunks, outputChunk]

      if (item.step === 'environment_script_output' && existing != null) {
        items.set(key, {
          ...existing,
          outputChunks
        })
        continue
      }

      items.set(key, createDisplayItem(item, outputChunks))
    }
    return Array.from(items.values()).map(item => normalizeProgressItem(item, progress))
  }, [progress])
  const hasError = progressItems.some(item => item.status === 'error' || item.step === 'workspace_failed')
  const isComplete = progressItems.some(item => item.status === 'success' && item.step === 'workspace_ready')
  const shouldCollapse = collapseWhenComplete && isComplete && !hasError
  const [isCollapsed, setIsCollapsed] = useState(shouldCollapse)

  useEffect(() => {
    if (shouldCollapse) {
      setIsCollapsed(true)
      return
    }

    if (!isComplete) {
      setIsCollapsed(false)
    }
  }, [isComplete, shouldCollapse])

  if (progressItems.length === 0) {
    return (
      <div className='session-creation-progress session-creation-progress--simple' role='status'>
        <span className='material-symbols-rounded'>hourglass_top</span>
        <span>{t('common.creatingChat')}</span>
      </div>
    )
  }

  return (
    <div className={`session-creation-progress ${isCollapsed ? 'is-collapsed' : ''}`} role='status' aria-live='polite'>
      <button
        type='button'
        className='session-creation-progress__title'
        aria-controls={stepsId}
        aria-expanded={!isCollapsed}
        onClick={() => setIsCollapsed(current => !current)}
      >
        <span className='session-creation-progress__title-icon material-symbols-rounded'>account_tree</span>
        <span className='session-creation-progress__title-copy'>
          <span className='session-creation-progress__title-main'>{t('chat.sessionCreationProgress.title')}</span>
        </span>
        <span className='session-creation-progress__toggle material-symbols-rounded'>expand_more</span>
      </button>
      <div id={stepsId} className='session-creation-progress__steps' hidden={isCollapsed}>
        {progressItems.map(item => <SessionCreationProgressStep key={getProgressItemKey(item)} item={item} />)}
      </div>
    </div>
  )
}
