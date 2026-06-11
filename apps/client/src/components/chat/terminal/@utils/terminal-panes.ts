/* eslint-disable max-lines -- terminal pane normalization and ordering rules are intentionally colocated. */
import type { TFunction } from 'i18next'

import type { TerminalShellKind } from '@oneworks/types'

export const DEFAULT_TERMINAL_ID = 'default'
export const TERMINAL_SHELL_KINDS: TerminalShellKind[] = ['default', 'zsh', 'bash', 'sh']

export interface TerminalPaneConfig {
  id: string
  title: string
  shellKind: TerminalShellKind
  initialCommand?: string
  surface?: TerminalPaneSurface
  runCommand?: TerminalPaneRunCommandTask
}

export interface TerminalPaneRunCommandTask {
  commandId: string
  icon: string
  script: string
  title: string
}

export type MoveTerminalPanePlacement = 'after' | 'before'
export type TerminalPaneSurface = 'bottom' | 'workspace-drawer'

export const DEFAULT_TERMINAL_PANE_SURFACE: TerminalPaneSurface = 'bottom'

const buildTerminalTitle = (index: number, t: TFunction) => t('chat.terminal.paneTitle', { index })

const createTerminalPaneId = () => `term-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

const normalizePaneId = (id: string) => id === DEFAULT_TERMINAL_ID ? createTerminalPaneId() : id

export const getNextTerminalTitle = (panes: TerminalPaneConfig[], t: TFunction) => {
  const usedTitles = new Set(panes.map(pane => pane.title.trim()).filter(Boolean))
  for (let index = 1; index <= panes.length + 1; index += 1) {
    const title = buildTerminalTitle(index, t)
    if (!usedTitles.has(title)) {
      return title
    }
  }

  return buildTerminalTitle(panes.length + 1, t)
}

export const withFixedTerminalTitles = (panes: TerminalPaneConfig[], t: TFunction) => {
  const titledPanes: TerminalPaneConfig[] = []
  for (const pane of panes) {
    const title = pane.title.trim()
    titledPanes.push({
      ...pane,
      title: title === '' ? getNextTerminalTitle(titledPanes, t) : title
    })
  }

  return titledPanes
}

const isTerminalShellKind = (value: unknown): value is TerminalShellKind => (
  typeof value === 'string' && TERMINAL_SHELL_KINDS.includes(value as TerminalShellKind)
)

const isTerminalPaneSurface = (value: unknown): value is TerminalPaneSurface => (
  value === 'bottom' || value === 'workspace-drawer'
)

export const getTerminalPaneSurface = (pane: Pick<TerminalPaneConfig, 'surface'>) =>
  pane.surface ?? DEFAULT_TERMINAL_PANE_SURFACE

export const isTerminalPaneOnSurface = (
  pane: Pick<TerminalPaneConfig, 'surface'>,
  surface: TerminalPaneSurface
) => getTerminalPaneSurface(pane) === surface

const normalizeCommand = (value: unknown) => {
  const command = typeof value === 'string' ? value.trim() : ''
  return command === '' ? undefined : command
}

const normalizeRunCommandTask = (value: unknown): TerminalPaneRunCommandTask | undefined => {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) {
    return undefined
  }

  const candidate = value as Partial<TerminalPaneRunCommandTask>
  const commandId = typeof candidate.commandId === 'string' ? candidate.commandId.trim() : ''
  const script = normalizeCommand(candidate.script)
  if (commandId === '' || script == null) {
    return undefined
  }

  const title = typeof candidate.title === 'string' && candidate.title.trim() !== ''
    ? candidate.title.trim()
    : commandId
  const icon = typeof candidate.icon === 'string' && candidate.icon.trim() !== '' ? candidate.icon.trim() : 'terminal'

  return {
    commandId,
    icon,
    script,
    title
  }
}

const normalizePane = (value: unknown): TerminalPaneConfig | null => {
  if (typeof value === 'string' && value.trim() !== '') {
    const id = value.trim()
    return {
      id: normalizePaneId(id),
      title: '',
      shellKind: 'default',
      surface: DEFAULT_TERMINAL_PANE_SURFACE
    }
  }

  if (value == null || typeof value !== 'object') {
    return null
  }

  const candidate = value as Partial<TerminalPaneConfig>
  const id = typeof candidate.id === 'string' ? candidate.id.trim() : ''
  if (id === '') {
    return null
  }

  return {
    id: normalizePaneId(id),
    title: typeof candidate.title === 'string' ? candidate.title : '',
    shellKind: isTerminalShellKind(candidate.shellKind) ? candidate.shellKind : 'default',
    surface: isTerminalPaneSurface(candidate.surface) ? candidate.surface : DEFAULT_TERMINAL_PANE_SURFACE,
    ...(normalizeCommand(candidate.initialCommand) != null
      ? { initialCommand: normalizeCommand(candidate.initialCommand) }
      : {}),
    ...(normalizeRunCommandTask(candidate.runCommand) != null
      ? { runCommand: normalizeRunCommandTask(candidate.runCommand) }
      : {})
  }
}

export const withExplicitTerminalPaneIds = (panes: TerminalPaneConfig[]) =>
  panes.map(pane => pane.id === DEFAULT_TERMINAL_ID ? { ...pane, id: createTerminalPaneId() } : pane)

export const normalizeTerminalPanes = (
  value: unknown,
  options: { fallback?: boolean } = {}
): TerminalPaneConfig[] => {
  const shouldFallback = options.fallback !== false

  if (!Array.isArray(value)) {
    return shouldFallback ? [createTerminalPane()] : []
  }

  const panes: TerminalPaneConfig[] = []
  const seen = new Set<string>()
  for (const item of value) {
    const pane = normalizePane(item)
    if (pane == null || seen.has(pane.id)) {
      continue
    }

    panes.push(pane)
    seen.add(pane.id)
  }

  if (panes.length > 0) {
    return panes
  }

  return shouldFallback ? [createTerminalPane()] : []
}

export const createTerminalPane = (
  shellKind: TerminalShellKind = 'default',
  title = '',
  initialCommand?: string,
  runCommand?: TerminalPaneRunCommandTask,
  surface: TerminalPaneSurface = DEFAULT_TERMINAL_PANE_SURFACE
): TerminalPaneConfig => ({
  id: createTerminalPaneId(),
  title,
  shellKind,
  surface,
  ...(normalizeCommand(initialCommand) != null ? { initialCommand: normalizeCommand(initialCommand) } : {}),
  ...(runCommand != null ? { runCommand } : {})
})

export const moveTerminalPane = (
  panes: TerminalPaneConfig[],
  sourceId: string,
  targetId: string,
  placement: MoveTerminalPanePlacement = 'before'
) => {
  const sourceIndex = panes.findIndex(item => item.id === sourceId)
  const targetIndex = panes.findIndex(item => item.id === targetId)
  if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) {
    return panes
  }

  const nextPanes = [...panes]
  const [moved] = nextPanes.splice(sourceIndex, 1)
  if (moved == null) {
    return panes
  }

  const nextTargetIndex = nextPanes.findIndex(item => item.id === targetId)
  if (nextTargetIndex < 0) {
    return panes
  }

  nextPanes.splice(nextTargetIndex + (placement === 'after' ? 1 : 0), 0, moved)
  return nextPanes
}
