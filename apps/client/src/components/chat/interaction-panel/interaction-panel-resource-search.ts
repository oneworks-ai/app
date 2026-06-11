import type { Session } from '@oneworks/core'

import type { WorkspaceTreeEntry } from '#~/api'
import { listSessionWorkspaceTree, listSessions, listWorkspaceTree } from '#~/api'

const MAX_MATCHED_FILE_RESULTS = 120
const MAX_SCANNED_DIRECTORIES = 240

export const MAX_VISIBLE_RESOURCE_RESULTS = 80
export const MAX_VISIBLE_RECENT_RESOURCE_RESULTS = 24

export type InteractionPanelResourceSearchResult =
  | { directory: string; id: string; kind: 'file'; name: string; path: string; updatedAt?: number }
  | { createdAt: number; id: string; kind: 'session'; sessionId: string; title: string }
  | {
    faviconUrl?: string
    id: string
    kind: 'website'
    source: 'history' | 'open'
    title: string
    updatedAt: number
    url: string
  }

type InteractionPanelSessionResourceSearchResult = Extract<InteractionPanelResourceSearchResult, { kind: 'session' }>

const canIndexDirectory = (entry: WorkspaceTreeEntry) =>
  entry.type === 'directory' && entry.linkKind == null && entry.isExternal !== true

const canOpenFile = (entry: WorkspaceTreeEntry) =>
  entry.type === 'file' &&
  (entry.linkKind == null || (entry.linkKind === 'symlink' && entry.linkType === 'file' && entry.isExternal !== true))

const getFileName = (path: string) => path.split('/').filter(Boolean).at(-1) ?? path

const getDirectory = (path: string, name: string) => path.endsWith(`/${name}`) ? path.slice(0, -name.length - 1) : ''

const getSessionTitle = (session: Session) => session.title?.trim() || session.lastUserMessage?.trim() || session.id

const getResourceText = (resource: InteractionPanelResourceSearchResult) => {
  if (resource.kind === 'file') return resource.path
  if (resource.kind === 'session') return `${resource.title} ${resource.sessionId}`
  return `${resource.title} ${resource.url}`
}

const matchesTokens = (text: string, tokens: string[]) => {
  const lowerText = text.toLowerCase()
  return tokens.every(token => lowerText.includes(token))
}

const scoreText = (text: string, query: string) => {
  const lowerText = text.toLowerCase()
  if (query === '') return 4
  if (lowerText === query) return 0
  if (lowerText.startsWith(query)) return 1
  if (lowerText.includes(`/${query}`) || lowerText.includes(` ${query}`)) return 2
  if (lowerText.includes(query)) return 3
  return 4
}

const getKindOrder = (resource: InteractionPanelResourceSearchResult) => {
  if (resource.kind === 'file') return 0
  if (resource.kind === 'session') return 1
  return 2
}

const getRecentTimestamp = (resource: InteractionPanelResourceSearchResult) => {
  if (resource.kind === 'file') return resource.updatedAt ?? 0
  if (resource.kind === 'session') return resource.createdAt
  return resource.updatedAt
}

export const getInteractionPanelResourceText = getResourceText

export const buildInteractionPanelFileResource = (
  path: string,
  options: { name?: string; updatedAt?: number } = {}
): InteractionPanelResourceSearchResult => {
  const name = options.name ?? getFileName(path)
  return {
    directory: getDirectory(path, name),
    id: `file:${path}`,
    kind: 'file',
    name,
    path,
    ...(options.updatedAt == null ? {} : { updatedAt: options.updatedAt })
  }
}

export const buildInteractionPanelRecentFileResources = (paths: string[]) =>
  paths
    .filter((path, index, list) => path.trim() !== '' && list.indexOf(path) === index)
    .map((path, index) => buildInteractionPanelFileResource(path, { updatedAt: Number.MAX_SAFE_INTEGER - index }))

export const compareInteractionPanelResources = (query: string) => {
  return (left: InteractionPanelResourceSearchResult, right: InteractionPanelResourceSearchResult) => {
    const scoreDelta = scoreText(getResourceText(left), query) - scoreText(getResourceText(right), query)
    if (scoreDelta !== 0) return scoreDelta
    const kindDelta = getKindOrder(left) - getKindOrder(right)
    if (kindDelta !== 0) return kindDelta
    return getResourceText(left).localeCompare(getResourceText(right))
  }
}

export const compareInteractionPanelRecentResources = (
  left: InteractionPanelResourceSearchResult,
  right: InteractionPanelResourceSearchResult
) => {
  const timeDelta = getRecentTimestamp(right) - getRecentTimestamp(left)
  if (timeDelta !== 0) return timeDelta
  const kindDelta = getKindOrder(left) - getKindOrder(right)
  if (kindDelta !== 0) return kindDelta
  return getResourceText(left).localeCompare(getResourceText(right))
}

export const collectInteractionPanelWorkspaceFiles = async ({
  isCancelled,
  queryTokens,
  sessionId
}: {
  isCancelled: () => boolean
  queryTokens: string[]
  sessionId?: string
}) => {
  const files: InteractionPanelResourceSearchResult[] = []
  const directories = ['']
  let indexedDirectoryCount = 0
  const loadTree = async (path?: string) =>
    sessionId == null || sessionId === ''
      ? await listWorkspaceTree(path)
      : await listSessionWorkspaceTree(sessionId, path)

  while (
    directories.length > 0 && files.length < MAX_MATCHED_FILE_RESULTS && indexedDirectoryCount < MAX_SCANNED_DIRECTORIES
  ) {
    const directory = directories.shift()
    indexedDirectoryCount += 1
    const { entries } = await loadTree(directory)
    if (isCancelled()) return files

    for (const entry of entries) {
      if (canOpenFile(entry)) {
        if (matchesTokens(entry.path, queryTokens)) {
          files.push(buildInteractionPanelFileResource(entry.path, { name: entry.name }))
        }
      } else if (canIndexDirectory(entry)) {
        directories.push(entry.path)
      }
      if (files.length >= MAX_MATCHED_FILE_RESULTS) break
    }
  }

  return files
}

export const collectInteractionPanelChildSessions = async (sessionId?: string) => {
  if (sessionId == null || sessionId === '') return []
  const { sessions } = await listSessions('active')
  return sessions
    .filter(session => session.parentSessionId === sessionId)
    .map((session): InteractionPanelSessionResourceSearchResult => ({
      createdAt: session.createdAt,
      id: `session:${session.id}`,
      kind: 'session',
      sessionId: session.id,
      title: getSessionTitle(session)
    }))
    .sort((left, right) => right.createdAt - left.createdAt)
}
