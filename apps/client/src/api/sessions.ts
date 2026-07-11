import type {
  ChatMessageContent,
  EffortLevel,
  Session,
  SessionMessageQueueState,
  SessionPermissionMode,
  SessionQueuedMessageMode
} from '@oneworks/core'
import type {
  GitBranchKind,
  MessageWorkspaceFileOpener,
  SessionPromptType,
  SessionWorkspace,
  WorkspaceFileOpenResponse
} from '@oneworks/types'

import { createApiUrl, fetchApiJson, fetchApiJsonOrThrow, jsonHeaders } from './base'
import type { ApiOkResponse, ApiRemoveResponse, SessionMessagesResponse } from './types'
import type { WorkspaceFileContent, WorkspacePathRevealResponse, WorkspaceTreeEntry } from './workspace'
import { routeWorkspaceResourceUrlThroughLauncher } from './workspace-resource'

export async function listSessions(
  filter: 'active' | 'archived' | 'all' = 'active'
): Promise<{ sessions: Session[] }> {
  const path = filter === 'archived' ? '/api/sessions/archived' : '/api/sessions'
  return fetchApiJson<{ sessions: Session[] }>(path)
}

export type NativeHistoryAdapter = 'codex' | 'claude-code'
export type NativeHistoryCandidateScope = 'all' | 'unarchived' | 'archived'
export type NativeHistoryProjectScope = 'current-project' | 'all-projects'
export type NativeHistoryThreadScope = 'all' | 'user' | 'subagent'
export type NativeHistoryTimeSort = 'activity' | 'createdAt' | 'updatedAt'

export interface NativeHistoryTimeRange {
  from?: number
  to?: number
}

export interface NativeHistoryTimeFilter {
  createdAt?: NativeHistoryTimeRange
  updatedAt?: NativeHistoryTimeRange
}

export interface NativeHistoryImportSession {
  adapter: NativeHistoryAdapter
  createdAt: number
  importedEvents: number
  sessionId: string
  sourcePath: string
  title: string
  updatedAt: number
}

export interface NativeHistoryImportResult {
  importedEvents: number
  importedSessions: number
  matchedFiles: number
  scannedFiles: number
  sessions: NativeHistoryImportSession[]
}

export interface NativeHistoryImportPreviewCandidate {
  adapter: NativeHistoryAdapter
  createdAt: number
  cwd: string
  fileSizeBytes: number
  importedSessionId?: string
  isArchived: boolean
  isImported: boolean
  isLarge: boolean
  isPinned: boolean
  nativeSessionId: string
  sourcePath: string
  threadSource?: string
  title: string
  updatedAt: number
}

export interface NativeHistoryImportAdapterPreview {
  adapter: NativeHistoryAdapter
  candidates: NativeHistoryImportPreviewCandidate[]
  hasMore: boolean
  isComplete: boolean
  largeFiles: number
  largestFileBytes: number
  matchedFiles: number
  nextCursor?: string
  scannedFiles: number
  totalBytes: number
}

export interface NativeHistoryImportPreviewResult {
  adapters: NativeHistoryImportAdapterPreview[]
  hasMore: boolean
  isComplete: boolean
  largeFileThresholdBytes: number
  largeFiles: number
  largestFileBytes: number
  matchedFiles: number
  nextCursor?: string
  scannedFiles: number
  totalBytes: number
}

export async function previewNativeProjectHistory(request?: {
  adapters?: NativeHistoryAdapter[]
  candidateScope?: NativeHistoryCandidateScope
  cursor?: string
  limit?: number
  projectScope?: NativeHistoryProjectScope
  signal?: AbortSignal
  sourcePaths?: string[]
  threadScope?: NativeHistoryThreadScope
  timeFilter?: NativeHistoryTimeFilter
  timeSort?: NativeHistoryTimeSort
}): Promise<NativeHistoryImportPreviewResult> {
  return fetchApiJson<NativeHistoryImportPreviewResult>('/api/sessions/native-history-import/preview', {
    method: 'POST',
    ...(request?.adapters != null || request?.candidateScope != null || request?.cursor != null ||
        request?.limit != null || request?.projectScope != null || request?.sourcePaths != null ||
        request?.threadScope != null || request?.timeFilter != null || request?.timeSort != null
      ? {
        headers: jsonHeaders,
        body: JSON.stringify({
          adapters: request.adapters,
          candidateScope: request.candidateScope,
          cursor: request.cursor,
          limit: request.limit,
          projectScope: request.projectScope,
          sourcePaths: request.sourcePaths,
          threadScope: request.threadScope,
          timeFilter: request.timeFilter,
          timeSort: request.timeSort
        })
      }
      : {}),
    signal: request?.signal
  })
}

export async function runNativeProjectHistoryImport(request?: {
  adapters?: NativeHistoryAdapter[]
  projectScope?: NativeHistoryProjectScope
  signal?: AbortSignal
  sourcePaths?: string[]
  threadScope?: NativeHistoryThreadScope
  timeFilter?: NativeHistoryTimeFilter
  timeSort?: NativeHistoryTimeSort
}): Promise<NativeHistoryImportResult> {
  return fetchApiJson<NativeHistoryImportResult>('/api/sessions/native-history-import/run', {
    method: 'POST',
    ...(request?.adapters != null || request?.projectScope != null || request?.sourcePaths != null ||
        request?.threadScope != null || request?.timeFilter != null || request?.timeSort != null
      ? {
        headers: jsonHeaders,
        body: JSON.stringify({
          adapters: request.adapters,
          projectScope: request.projectScope,
          sourcePaths: request.sourcePaths,
          threadScope: request.threadScope,
          timeFilter: request.timeFilter,
          timeSort: request.timeSort
        })
      }
      : {}),
    signal: request?.signal
  })
}

export function getSessionCacheKey(id: string) {
  return `/api/sessions/${encodeURIComponent(id)}`
}

export async function getSession(id: string): Promise<{ session: Session }> {
  return fetchApiJson<{ session: Session }>(getSessionCacheKey(id))
}

export async function createSession(
  title?: string,
  initialMessage?: string,
  initialContent?: ChatMessageContent[],
  model?: string,
  options?: {
    start?: boolean
    parentSessionId?: string
    id?: string
    promptType?: SessionPromptType
    promptName?: string
    effort?: EffortLevel
    fastMode?: boolean
    permissionMode?: 'default' | 'acceptEdits' | 'plan' | 'dontAsk' | 'bypassPermissions'
    adapter?: string
    account?: string
    tags?: string[]
    updateSkills?: boolean
    workspace?: {
      sourceSessionId?: string
      createWorktree?: boolean
      worktreeEnvironment?: string
      branch?: {
        name: string
        kind?: GitBranchKind
        mode?: 'checkout' | 'create'
      }
    }
  },
  request?: {
    signal?: AbortSignal
  }
): Promise<{ session: Session }> {
  return fetchApiJson<{ session: Session }>('/api/sessions', {
    method: 'POST',
    headers: jsonHeaders,
    signal: request?.signal,
    body: JSON.stringify({
      title,
      initialMessage,
      initialContent,
      model,
      start: options?.start,
      parentSessionId: options?.parentSessionId,
      id: options?.id,
      promptType: options?.promptType,
      promptName: options?.promptName,
      effort: options?.effort,
      fastMode: options?.fastMode,
      permissionMode: options?.permissionMode,
      adapter: options?.adapter,
      account: options?.account,
      tags: options?.tags,
      updateSkills: options?.updateSkills,
      workspace: options?.workspace
    })
  })
}

export async function forkSession(id: string, title?: string): Promise<{ session: Session }> {
  return fetchApiJson<{ session: Session }>(`/api/sessions/${id}/fork`, {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify({ title })
  })
}

export async function branchSessionFromMessage(
  sessionId: string,
  messageId: string,
  action: 'fork' | 'recall' | 'edit',
  options?: {
    content?: string | ChatMessageContent[]
    title?: string
  }
): Promise<{ session: Session }> {
  return fetchApiJson<{ session: Session }>(`/api/sessions/${sessionId}/messages/${messageId}/branch`, {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify({
      action,
      content: options?.content,
      title: options?.title
    })
  })
}

export async function getSessionMessages(
  id: string,
  options?: number | {
    afterId?: number
    beforeId?: number
    limit?: number
  }
): Promise<SessionMessagesResponse> {
  const url = createApiUrl(`/api/sessions/${id}/messages`)
  const resolvedOptions = typeof options === 'number' ? { limit: options } : options
  if (resolvedOptions?.limit != null) {
    url.searchParams.set('limit', resolvedOptions.limit.toString())
  }
  if (resolvedOptions?.beforeId != null) {
    url.searchParams.set('beforeId', resolvedOptions.beforeId.toString())
  }
  if (resolvedOptions?.afterId != null) {
    url.searchParams.set('afterId', resolvedOptions.afterId.toString())
  }
  return fetchApiJson<SessionMessagesResponse>(url)
}

export async function sendSessionMessage(
  id: string,
  content: string | ChatMessageContent[],
  options: {
    permissionMode?: SessionPermissionMode
  } = {}
): Promise<ApiOkResponse> {
  const body = Array.isArray(content) ? { content } : { text: content }
  return fetchApiJson<ApiOkResponse>(`/api/sessions/${id}/messages`, {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify({
      ...body,
      permissionMode: options.permissionMode
    })
  })
}

export async function terminateSession(id: string): Promise<ApiOkResponse> {
  return fetchApiJson<ApiOkResponse>(`/api/sessions/${id}/terminate`, {
    method: 'POST'
  })
}

export async function getSessionWorkspace(id: string): Promise<{ workspace: SessionWorkspace }> {
  return fetchApiJson<{ workspace: SessionWorkspace }>(`/api/sessions/${id}/workspace`)
}

export async function createSessionManagedWorktree(
  id: string
): Promise<{ workspace: SessionWorkspace }> {
  return fetchApiJson<{ workspace: SessionWorkspace }>(`/api/sessions/${id}/workspace/create-worktree`, {
    method: 'POST'
  })
}

export async function transferSessionWorkspaceToLocal(
  id: string
): Promise<{ workspace: SessionWorkspace }> {
  return fetchApiJson<{ workspace: SessionWorkspace }>(`/api/sessions/${id}/workspace/transfer-local`, {
    method: 'POST'
  })
}

export async function listSessionWorkspaceTree(
  id: string,
  path?: string
): Promise<{
  path: string
  entries: WorkspaceTreeEntry[]
}> {
  const url = createApiUrl(`/api/sessions/${id}/workspace/tree`)
  if (path != null && path.trim() !== '') {
    url.searchParams.set('path', path)
  }
  return fetchApiJson<{
    path: string
    entries: WorkspaceTreeEntry[]
  }>(url)
}

export async function readSessionWorkspaceFile(
  id: string,
  path: string
): Promise<WorkspaceFileContent> {
  const url = createApiUrl(`/api/sessions/${id}/workspace/file`)
  url.searchParams.set('path', path)
  return fetchApiJson<WorkspaceFileContent>(url)
}

export async function openSessionWorkspaceFileInExternalOpener(
  id: string,
  path: string,
  options: {
    column?: number
    line?: number
    opener?: MessageWorkspaceFileOpener
  } = {}
): Promise<WorkspaceFileOpenResponse> {
  return fetchApiJson<WorkspaceFileOpenResponse>(`/api/sessions/${id}/workspace/open-file`, {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify({
      path,
      line: options.line,
      column: options.column,
      opener: options.opener
    })
  })
}

export async function revealSessionWorkspacePathInFileManager(
  id: string,
  path: string
): Promise<WorkspacePathRevealResponse> {
  return fetchApiJson<WorkspacePathRevealResponse>(`/api/sessions/${id}/workspace/reveal-path`, {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify({ path })
  })
}

export function getSessionWorkspaceResourceUrl(id: string, path: string) {
  const url = createApiUrl(`/api/sessions/${encodeURIComponent(id)}/workspace/resource`)
  url.searchParams.set('path', path)
  return routeWorkspaceResourceUrlThroughLauncher(url, { path, sessionId: id }).toString()
}

export async function updateSessionWorkspaceFile(
  id: string,
  path: string,
  content: string
): Promise<WorkspaceFileContent> {
  return fetchApiJson<WorkspaceFileContent>(`/api/sessions/${id}/workspace/file`, {
    method: 'PUT',
    headers: jsonHeaders,
    body: JSON.stringify({ path, content })
  })
}

export async function respondSessionInteraction(
  sessionId: string,
  interactionId: string,
  data: string | string[]
): Promise<ApiOkResponse> {
  return fetchApiJson<ApiOkResponse>(`/api/sessions/${sessionId}/events`, {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify({
      type: 'interaction_response',
      id: interactionId,
      data
    })
  })
}

export async function deleteSession(
  id: string,
  options: {
    force?: boolean
  } = {}
): Promise<ApiRemoveResponse> {
  const url = createApiUrl(`/api/sessions/${id}`)
  if (options.force === true) {
    url.searchParams.set('force', 'true')
  }

  return fetchApiJsonOrThrow<ApiRemoveResponse>(
    url,
    { method: 'DELETE' },
    '[api] delete session failed:'
  )
}

export async function updateSession(id: string, data: Partial<Session>): Promise<ApiOkResponse> {
  return fetchApiJson<ApiOkResponse>(`/api/sessions/${id}`, {
    method: 'PATCH',
    headers: jsonHeaders,
    body: JSON.stringify(data)
  })
}

export async function updateSessionTitle(id: string, title: string): Promise<ApiOkResponse> {
  return updateSession(id, { title })
}

export async function createQueuedMessage(
  sessionId: string,
  mode: SessionQueuedMessageMode,
  content: ChatMessageContent[]
): Promise<{ queuedMessages: SessionMessageQueueState }> {
  return fetchApiJson<{ queuedMessages: SessionMessageQueueState }>(`/api/sessions/${sessionId}/queued-messages`, {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify({ mode, content })
  })
}

export async function updateQueuedMessage(
  sessionId: string,
  queueId: string,
  content: ChatMessageContent[]
): Promise<{ queuedMessages: SessionMessageQueueState }> {
  return fetchApiJson<{ queuedMessages: SessionMessageQueueState }>(
    `/api/sessions/${sessionId}/queued-messages/${queueId}`,
    {
      method: 'PATCH',
      headers: jsonHeaders,
      body: JSON.stringify({ content })
    }
  )
}

export async function deleteQueuedMessage(
  sessionId: string,
  queueId: string
): Promise<{ queuedMessages: SessionMessageQueueState }> {
  return fetchApiJson<{ queuedMessages: SessionMessageQueueState }>(
    `/api/sessions/${sessionId}/queued-messages/${queueId}`,
    {
      method: 'DELETE'
    }
  )
}

export async function moveQueuedMessage(
  sessionId: string,
  queueId: string,
  mode: SessionQueuedMessageMode
): Promise<{ queuedMessages: SessionMessageQueueState }> {
  return fetchApiJson<{ queuedMessages: SessionMessageQueueState }>(
    `/api/sessions/${sessionId}/queued-messages/${queueId}/move`,
    {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({ mode })
    }
  )
}

export async function reorderQueuedMessages(
  sessionId: string,
  mode: SessionQueuedMessageMode,
  ids: string[]
): Promise<{ queuedMessages: SessionMessageQueueState }> {
  return fetchApiJson<{ queuedMessages: SessionMessageQueueState }>(
    `/api/sessions/${sessionId}/queued-messages/reorder`,
    {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({ mode, ids })
    }
  )
}
