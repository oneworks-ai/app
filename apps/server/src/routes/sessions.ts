import { Buffer } from 'node:buffer'
import { Readable } from 'node:stream'

import Router from '@koa/router'
import type { Context } from 'koa'

import type {
  ChatMessage,
  ChatMessageContent,
  EffortLevel,
  SessionPanelState,
  SessionPermissionMode,
  WSEvent
} from '@oneworks/core'
import { CODEX_PROJECT_CONFIG_RELATIVE_PATH } from '@oneworks/runtime-protocol'
import type { GitBranchKind, SessionInfo, SessionInitInfo, SessionPromptType } from '@oneworks/types'

import { getDb } from '#~/db/index.js'
import {
  consumeNativeProjectHistoryImportPrompt,
  importNativeProjectHistoryAndReplay,
  previewNativeProjectHistory
} from '#~/services/runtime-store/history-import.js'
import type {
  NativeHistoryAdapter,
  NativeHistoryCandidateScope,
  NativeHistoryProjectScope,
  NativeHistoryThreadScope,
  NativeHistoryTimeFilter,
  NativeHistoryTimeRange,
  NativeHistoryTimeSort
} from '#~/services/runtime-store/history-import.js'
import {
  createServerRuntimeSession,
  summarizeRuntimeSessionContent
} from '#~/services/runtime-store/session-control.js'
import {
  sanitizePublicAdapterEventData,
  sanitizePublicQueuedSessionMessage,
  sanitizePublicSessionRecord,
  sanitizePublicStoredSessionEvent,
  createPublicProjectionContext,
  projectPublicResponse
} from '#~/services/runtime-store/public-runtime-event.js'
import type { PublicProjectionContext } from '#~/services/runtime-store/public-runtime-event.js'
import { deleteRuntimeSessionStores } from '#~/services/runtime-store/session-delete.js'
import { createSessionWithInitialMessage } from '#~/services/session/create.js'
import { cancelSessionCreation, isSessionCreationCancelledError } from '#~/services/session/creation-cancellation.js'
import { applySessionEvent } from '#~/services/session/events.js'
import { branchSessionFromMessage, buildHistorySeedFromEvents } from '#~/services/session/history.js'
import {
  killSession,
  processUserMessage,
  requestSessionTermination,
  resolveExternalRuntimeProjectConfigFailure,
  retryExternalRuntimeSessionProjectConfig,
  updateAndNotifySession
} from '#~/services/session/index.js'
import {
  getSessionInteraction,
  handleInteractionResponse,
  projectAndSetSessionInteraction
} from '#~/services/session/interaction.js'
import {
  createSessionQueuedMessage,
  deleteSessionQueuedMessage,
  listSessionQueuedMessages,
  moveSessionQueuedMessage,
  reorderSessionQueuedMessages,
  updateSessionQueuedMessage
} from '#~/services/session/queue.js'
import {
  broadcastSessionEvent,
  notifySessionCreationProgress,
  notifySessionUpdated
} from '#~/services/session/runtime.js'
import { finalizeSessionWorkspaceChangeTracking } from '#~/services/session/workspace-changes.js'
import {
  createSessionManagedWorktree,
  deleteSessionWorkspace,
  provisionSessionWorkspace,
  resolveSessionWorkspace,
  resolveSessionWorkspaceFolder,
  transferSessionWorkspaceToLocal
} from '#~/services/session/workspace.js'
import { disposeTerminalSession } from '#~/services/terminal/index.js'
import { revealWorkspacePathInFileManager } from '#~/services/workspace/file-manager.js'
import { openWorkspaceFileInExternalOpener } from '#~/services/workspace/file-opener.js'
import { readWorkspaceFile, updateWorkspaceFile } from '#~/services/workspace/file.js'
import { resolveWorkspaceMediaResource } from '#~/services/workspace/media.js'
import { listWorkspaceTree } from '#~/services/workspace/tree.js'
import { badRequest, conflict, methodNotAllowed, notFound } from '#~/utils/http.js'

import { sendWorkspaceMediaResponse } from './workspace-media-response'
import {
  parseSessionPatchRequest,
  parseSessionQueueCreateRequest,
  parseSessionQueueMoveRequest,
  parseSessionQueueReorderRequest,
  parseSessionQueueUpdateRequest
} from './session-request-plans'

export function sessionsRouter(): Router {
  const router = new Router()
  const db = getDb()
  // A request owns exactly one aggregate projection budget.  This applies
  // after the route-specific fresh constructors, protecting every list item
  // and response branch (including create/branch/fork/queue responses).
  router.use(async (ctx, next) => {
    const context = createPublicProjectionContext()
    ctx.state.publicProjectionContext = context
    await next()
    if (ctx.body == null) return
    if (
      ctx.state.skipApiEnvelope === true ||
      Buffer.isBuffer(ctx.body) ||
      ctx.body instanceof Readable
    ) return
    const publicBody = projectPublicResponse(ctx.body, context)
    if (publicBody === undefined) {
      throw badRequest('Response exceeds public projection budget', undefined, 'public_projection_too_large')
    }
    ctx.body = publicBody
  })
  const responseContext = (ctx: Context) => {
    ctx.state ??= {}
    ctx.state.publicProjectionContext ??= createPublicProjectionContext()
    return ctx.state.publicProjectionContext as PublicProjectionContext
  }
  const publicSession = (
    session: unknown,
    sessionId: string | undefined,
    context: PublicProjectionContext
  ) => sanitizePublicSessionRecord(session, sessionId, context)
  const publicQueuedMessages = (sessionId: string, context: PublicProjectionContext) =>
    listSessionQueuedMessages(sessionId).flatMap(message => {
      const publicMessage = sanitizePublicQueuedSessionMessage(message, sessionId, context)
      return publicMessage == null ? [] : [publicMessage]
    })
  const sessionPermissionModes = new Set<SessionPermissionMode>([
    'default',
    'acceptEdits',
    'plan',
    'dontAsk',
    'bypassPermissions'
  ])
  const nativeHistoryAdapters = new Set<NativeHistoryAdapter>(['codex', 'claude-code'])
  const nativeHistoryCandidateScopes = new Set<NativeHistoryCandidateScope>(['all', 'unarchived', 'archived'])
  const nativeHistoryProjectScopes = new Set<NativeHistoryProjectScope>(['current-project', 'all-projects'])
  const nativeHistoryThreadScopes = new Set<NativeHistoryThreadScope>(['all', 'user', 'subagent'])
  const nativeHistoryTimeSorts = new Set<NativeHistoryTimeSort>(['activity', 'createdAt', 'updatedAt'])
  const normalizeTags = (value: unknown) => {
    if (!Array.isArray(value)) return undefined
    if (value.length > 64 || value.some(tag => typeof tag !== 'string')) return undefined
    const tags = value.map(tag => tag.trim())
    return tags.some(tag => tag === '' || tag.length > 128) ? undefined : tags
  }
  const isSessionPermissionMode = (value: unknown): value is SessionPermissionMode => (
    typeof value === 'string' && sessionPermissionModes.has(value as SessionPermissionMode)
  )

  const parsePositiveInt = (value?: string) => {
    if (value == null) {
      return null
    }

    const n = Number.parseInt(value, 10)
    return Number.isNaN(n) || n <= 0 ? null : n
  }

  const parseLimit = (limit?: string) => {
    const parsed = parsePositiveInt(limit)
    return parsed == null ? null : Math.min(parsed, 1000)
  }

  const normalizeMessageContent = (body: {
    content?: unknown
    text?: unknown
  }) => {
    if (Array.isArray(body.content) && body.content.length > 0) {
      return body.content as ChatMessageContent[]
    }

    if (typeof body.text === 'string' && body.text.trim() !== '') {
      return body.text.trim()
    }

    return undefined
  }

  const normalizeNativeHistoryAdapters = (value: unknown) => {
    if (value === undefined) {
      return undefined
    }
    if (!Array.isArray(value)) {
      throw badRequest('Invalid native history adapters', { adapters: value }, 'invalid_native_history_adapters')
    }

    const adapters = Array.from(new Set(value))
    const invalidAdapter = adapters.find(adapter => (
      typeof adapter !== 'string' ||
      !nativeHistoryAdapters.has(adapter as NativeHistoryAdapter)
    ))
    if (invalidAdapter != null) {
      throw badRequest(
        'Invalid native history adapter',
        { adapter: invalidAdapter },
        'invalid_native_history_adapter'
      )
    }

    return adapters as NativeHistoryAdapter[]
  }

  const normalizeNativeHistorySourcePaths = (value: unknown) => {
    if (value === undefined) {
      return undefined
    }
    if (!Array.isArray(value)) {
      throw badRequest(
        'Invalid native history source paths',
        { sourcePaths: value },
        'invalid_native_history_source_paths'
      )
    }

    const sourcePaths = value.map(sourcePath => typeof sourcePath === 'string' ? sourcePath.trim() : '')
    if (sourcePaths.includes('')) {
      throw badRequest(
        'Invalid native history source path',
        { sourcePaths: value },
        'invalid_native_history_source_path'
      )
    }
    return Array.from(new Set(sourcePaths))
  }

  const normalizeNativeHistoryProjectScope = (value: unknown) => {
    if (value === undefined) {
      return undefined
    }
    if (typeof value !== 'string' || !nativeHistoryProjectScopes.has(value as NativeHistoryProjectScope)) {
      throw badRequest(
        'Invalid native history project scope',
        { projectScope: value },
        'invalid_native_history_project_scope'
      )
    }
    return value as NativeHistoryProjectScope
  }

  const normalizeNativeHistoryCandidateScope = (value: unknown) => {
    if (value === undefined) {
      return undefined
    }
    if (typeof value !== 'string' || !nativeHistoryCandidateScopes.has(value as NativeHistoryCandidateScope)) {
      throw badRequest(
        'Invalid native history candidate scope',
        { candidateScope: value },
        'invalid_native_history_candidate_scope'
      )
    }
    return value as NativeHistoryCandidateScope
  }

  const normalizeNativeHistoryThreadScope = (value: unknown) => {
    if (value === undefined) {
      return undefined
    }
    if (typeof value !== 'string' || !nativeHistoryThreadScopes.has(value as NativeHistoryThreadScope)) {
      throw badRequest(
        'Invalid native history thread scope',
        { threadScope: value },
        'invalid_native_history_thread_scope'
      )
    }
    return value as NativeHistoryThreadScope
  }

  const normalizeNativeHistoryTimestamp = (value: unknown, field: string) => {
    if (value === undefined) {
      return undefined
    }
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
      throw badRequest(
        'Invalid native history time filter',
        { field, value },
        'invalid_native_history_time_filter'
      )
    }
    return value
  }

  const normalizeNativeHistoryTimeRange = (
    value: unknown,
    field: string
  ): NativeHistoryTimeRange | undefined => {
    if (value === undefined) {
      return undefined
    }
    if (value == null || typeof value !== 'object' || Array.isArray(value)) {
      throw badRequest(
        'Invalid native history time filter',
        { field, value },
        'invalid_native_history_time_filter'
      )
    }

    const range = value as { from?: unknown; to?: unknown }
    const from = normalizeNativeHistoryTimestamp(range.from, `${field}.from`)
    const to = normalizeNativeHistoryTimestamp(range.to, `${field}.to`)
    if (from != null && to != null && from > to) {
      throw badRequest(
        'Invalid native history time filter range',
        { field, from, to },
        'invalid_native_history_time_filter'
      )
    }
    return {
      ...(from == null ? {} : { from }),
      ...(to == null ? {} : { to })
    }
  }

  const normalizeNativeHistoryTimeFilter = (value: unknown): NativeHistoryTimeFilter | undefined => {
    if (value === undefined) {
      return undefined
    }
    if (value == null || typeof value !== 'object' || Array.isArray(value)) {
      throw badRequest(
        'Invalid native history time filter',
        { timeFilter: value },
        'invalid_native_history_time_filter'
      )
    }

    const filter = value as { createdAt?: unknown; updatedAt?: unknown }
    const createdAt = normalizeNativeHistoryTimeRange(filter.createdAt, 'createdAt')
    const updatedAt = normalizeNativeHistoryTimeRange(filter.updatedAt, 'updatedAt')
    return {
      ...(createdAt == null ? {} : { createdAt }),
      ...(updatedAt == null ? {} : { updatedAt })
    }
  }

  const normalizeNativeHistoryTimeSort = (value: unknown) => {
    if (value === undefined) {
      return undefined
    }
    if (typeof value !== 'string' || !nativeHistoryTimeSorts.has(value as NativeHistoryTimeSort)) {
      throw badRequest(
        'Invalid native history time sort',
        { timeSort: value },
        'invalid_native_history_time_sort'
      )
    }
    return value as NativeHistoryTimeSort
  }

  const normalizeNativeHistoryPreviewCursor = (value: unknown) => {
    if (value === undefined) {
      return undefined
    }
    if (typeof value !== 'string' || value.trim() === '') {
      throw badRequest(
        'Invalid native history preview cursor',
        { cursor: value },
        'invalid_native_history_preview_cursor'
      )
    }
    return value
  }

  const normalizeNativeHistoryPreviewLimit = (value: unknown) => {
    if (value === undefined) {
      return undefined
    }
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 100) {
      throw badRequest(
        'Invalid native history preview limit',
        { limit: value },
        'invalid_native_history_preview_limit'
      )
    }
    return value
  }

  router.get(['/', ''], (ctx) => {
    ctx.body = { sessions: db.getSessions('active').flatMap(session => {
      const publicRecord = publicSession(session, session.id, responseContext(ctx))
      return publicRecord == null ? [] : [publicRecord]
    }) }
  })

  router.get('/archived', (ctx) => {
    ctx.body = { sessions: db.getSessions('archived').flatMap(session => {
      const publicRecord = publicSession(session, session.id, responseContext(ctx))
      return publicRecord == null ? [] : [publicRecord]
    }) }
  })

  router.post('/native-history-import', async (ctx) => {
    ctx.body = await consumeNativeProjectHistoryImportPrompt()
  })

  router.post('/native-history-import/preview', async (ctx) => {
    const body = (ctx.request.body ?? {}) as {
      adapters?: unknown
      candidateScope?: unknown
      cursor?: unknown
      limit?: unknown
      projectScope?: unknown
      sourcePaths?: unknown
      threadScope?: unknown
      timeFilter?: unknown
      timeSort?: unknown
    }
    const adapters = normalizeNativeHistoryAdapters(body.adapters)
    const candidateScope = normalizeNativeHistoryCandidateScope(body.candidateScope)
    const previewCursor = normalizeNativeHistoryPreviewCursor(body.cursor)
    const previewLimit = normalizeNativeHistoryPreviewLimit(body.limit)
    const projectScope = normalizeNativeHistoryProjectScope(body.projectScope)
    const sourcePaths = normalizeNativeHistorySourcePaths(body.sourcePaths)
    const threadScope = normalizeNativeHistoryThreadScope(body.threadScope)
    const timeFilter = normalizeNativeHistoryTimeFilter(body.timeFilter)
    const timeSort = normalizeNativeHistoryTimeSort(body.timeSort)
    ctx.body = await previewNativeProjectHistory({
      ...(adapters == null ? {} : { adapters }),
      ...(candidateScope == null ? {} : { candidateScope }),
      ...(previewCursor == null ? {} : { previewCursor }),
      ...(previewLimit == null ? {} : { previewLimit }),
      ...(projectScope == null ? {} : { projectScope }),
      ...(sourcePaths == null ? {} : { sourcePaths }),
      ...(threadScope == null ? {} : { threadScope }),
      ...(timeFilter == null ? {} : { timeFilter }),
      ...(timeSort == null ? {} : { timeSort })
    })
  })

  router.post('/native-history-import/run', async (ctx) => {
    const body = (ctx.request.body ?? {}) as {
      adapters?: unknown
      projectScope?: unknown
      sourcePaths?: unknown
      threadScope?: unknown
      timeFilter?: unknown
      timeSort?: unknown
    }
    const adapters = normalizeNativeHistoryAdapters(body.adapters)
    const projectScope = normalizeNativeHistoryProjectScope(body.projectScope)
    const sourcePaths = normalizeNativeHistorySourcePaths(body.sourcePaths)
    const threadScope = normalizeNativeHistoryThreadScope(body.threadScope)
    const timeFilter = normalizeNativeHistoryTimeFilter(body.timeFilter)
    const timeSort = normalizeNativeHistoryTimeSort(body.timeSort)
    ctx.body = await importNativeProjectHistoryAndReplay({
      ...(adapters == null ? {} : { adapters }),
      ...(projectScope == null ? {} : { projectScope }),
      ...(sourcePaths == null ? {} : { sourcePaths }),
      ...(threadScope == null ? {} : { threadScope }),
      ...(timeFilter == null ? {} : { timeFilter }),
      ...(timeSort == null ? {} : { timeSort })
    })
  })

  router.get('/:id', (ctx) => {
    const { id } = ctx.params as { id: string }
    const session = db.getSession(id)
    if (session == null) {
      throw notFound('Session not found', { id }, 'session_not_found')
    }

    ctx.body = { session: publicSession(session, id, responseContext(ctx)) }
  })

  router.get('/:id/messages', (ctx) => {
    const { id } = ctx.params as { id: string }
    const { afterId, beforeId, limit } = ctx.query as {
      afterId?: string
      beforeId?: string
      limit?: string
    }
    const session = db.getSession(id)
    if (session == null) {
      throw notFound('Session not found', { id }, 'session_not_found')
    }
    const messagesContext = responseContext(ctx)
    const interaction = getSessionInteraction(id, messagesContext)

    const parsedLimit = parseLimit(limit)
    const parsedBeforeId = parsePositiveInt(beforeId)
    const parsedAfterId = parsePositiveInt(afterId)
    const messageWindow = db.getMessageWindowWithCursor(
      id,
      parsedLimit == null && parsedBeforeId == null && parsedAfterId == null
        ? {}
        : {
          ...(parsedAfterId != null ? { afterId: parsedAfterId } : {}),
          ...(parsedBeforeId != null ? { beforeId: parsedBeforeId } : {}),
          limit: parsedLimit ?? 200
        }
    )
    const workspaceFolder = db.getSessionWorkspace(id)?.workspaceFolder
    ctx.body = {
      cursor: messageWindow.cursor,
      messages: messageWindow.messages.flatMap(message => {
        const publicMessage = sanitizePublicStoredSessionEvent(
          message,
          id,
          workspaceFolder,
          session.adapter,
          messagesContext
        )
        return publicMessage == null ? [] : [publicMessage]
      }),
      session: publicSession(session, id, messagesContext),
      interaction,
      queuedMessages: publicQueuedMessages(id, messagesContext)
    }
  })

  router.post('/:id/messages', (ctx) => {
    const { id } = ctx.params as { id: string }
    const session = db.getSession(id)
    if (session == null) {
      throw notFound('Session not found', { id }, 'session_not_found')
    }

    const body = ctx.request.body as { content?: unknown; text?: unknown; permissionMode?: unknown }
    const content = normalizeMessageContent(body)
    if (content == null) {
      throw badRequest('Message content cannot be empty', undefined, 'empty_message_content')
    }

    if (body.permissionMode !== undefined) {
      if (!isSessionPermissionMode(body.permissionMode)) {
        throw badRequest(
          'Invalid permission mode',
          { permissionMode: body.permissionMode },
          'invalid_permission_mode'
        )
      }

      if (session.permissionMode !== body.permissionMode) {
        updateAndNotifySession(id, { permissionMode: body.permissionMode })
      }
    }

    void processUserMessage(id, content).catch(() => undefined)
    ctx.body = { ok: true }
  })

  router.post('/:id/retry-project-config', async (ctx) => {
    const { id } = ctx.params as { id: string }
    const session = db.getSession(id)
    if (session == null) {
      throw notFound('Session not found', { id }, 'session_not_found')
    }
    if (session.status !== 'failed') {
      throw conflict(
        'Only a failed session can retry project config recovery.',
        { id, status: session.status },
        'session_not_failed'
      )
    }
    const result = await retryExternalRuntimeSessionProjectConfig(id)
    if ('reason' in result && result.reason === 'runtime_store_missing') {
      throw conflict(
        'The runtime store required to retry this session is unavailable.',
        { id },
        'runtime_store_missing'
      )
    }
    if ('reason' in result && result.reason === 'current_failure_ineligible') {
      throw conflict(
        'The current runtime failure is not eligible for project config recovery.',
        { id },
        'project_config_recovery_unavailable'
      )
    }
    ctx.body = { ok: true, ...result }
  })

  router.post('/:id/project-config/open', async (ctx) => {
    const { id } = ctx.params as { id: string }
    if (db.getSession(id) == null) {
      throw notFound('Session not found', { id }, 'session_not_found')
    }
    const failure = await resolveExternalRuntimeProjectConfigFailure(id)
    if (!failure.available) {
      throw conflict(
        'The current runtime failure has no safe project config target.',
        { id, reason: failure.reason },
        'project_config_recovery_unavailable'
      )
    }
    ctx.body = await openWorkspaceFileInExternalOpener(
      CODEX_PROJECT_CONFIG_RELATIVE_PATH,
      {
        column: failure.details.column,
        line: failure.details.line,
        workspaceFolder: failure.workspaceFolder
      }
    )
  })

  router.get('/:id/workspace', async (ctx) => {
    const { id } = ctx.params as { id: string }
    ctx.body = {
      workspace: await resolveSessionWorkspace(id)
    }
  })

  router.get('/:id/workspace/tree', async (ctx) => {
    const { id } = ctx.params as { id: string }
    const { path } = ctx.query as { path?: string }
    const workspaceFolder = await resolveSessionWorkspaceFolder(id)
    ctx.body = await listWorkspaceTree(path, { workspaceFolder })
  })

  router.get('/:id/workspace/file', async (ctx) => {
    const { id } = ctx.params as { id: string }
    const { path } = ctx.query as { path?: string }
    const workspaceFolder = await resolveSessionWorkspaceFolder(id)
    ctx.body = await readWorkspaceFile(path, { workspaceFolder })
  })

  router.post('/:id/workspace/open-file', async (ctx) => {
    const { id } = ctx.params as { id: string }
    const { column, line, opener, path } = ctx.request.body as {
      column?: unknown
      line?: unknown
      opener?: unknown
      path?: string
    }
    const workspaceFolder = await resolveSessionWorkspaceFolder(id)
    ctx.body = await openWorkspaceFileInExternalOpener(path, { column, line, opener, workspaceFolder })
  })

  router.post('/:id/workspace/reveal-path', async (ctx) => {
    const { id } = ctx.params as { id: string }
    const { path } = ctx.request.body as { path?: string }
    const workspaceFolder = await resolveSessionWorkspaceFolder(id)
    ctx.body = await revealWorkspacePathInFileManager(path, { workspaceFolder })
  })

  const handleSessionWorkspaceResource = async (ctx: Context) => {
    const { id } = ctx.params as { id: string }
    const { path } = ctx.query as { path?: string }
    const workspaceFolder = await resolveSessionWorkspaceFolder(id)
    const resource = await resolveWorkspaceMediaResource(path, {
      allowProductArtifactPaths: true,
      workspaceFolder
    })
    await sendWorkspaceMediaResponse(ctx, resource)
  }

  router.get('/:id/workspace/resource', handleSessionWorkspaceResource)
  router.head('/:id/workspace/resource', handleSessionWorkspaceResource)

  router.put('/:id/workspace/file', async (ctx) => {
    const { id } = ctx.params as { id: string }
    const { content, path } = ctx.request.body as { content?: unknown; path?: string }
    const workspaceFolder = await resolveSessionWorkspaceFolder(id)
    ctx.body = await updateWorkspaceFile(path, content, { workspaceFolder })
  })

  router.post('/:id/workspace/create-worktree', async (ctx) => {
    const { id } = ctx.params as { id: string }
    const workspace = await createSessionManagedWorktree(id)
    killSession(id, { recordWorkspaceChanges: false })
    disposeTerminalSession(id)
    ctx.body = { workspace }
  })

  router.post('/:id/workspace/transfer-local', async (ctx) => {
    const { id } = ctx.params as { id: string }
    ctx.body = {
      workspace: await transferSessionWorkspaceToLocal(id)
    }
  })

  router.patch('/:id', (ctx) => {
    const { id } = ctx.params as { id: string }
    const plan = parseSessionPatchRequest(ctx.request.body)
    if (plan == null) throw badRequest('Invalid session update', undefined, 'invalid_session_update')
    const { title, isStarred, isArchived, tags, panelState, permissionMode } = plan
    if (
      title !== undefined ||
      isStarred !== undefined ||
      panelState !== undefined ||
      permissionMode !== undefined
    ) {
      updateAndNotifySession(id, {
        title,
        isStarred,
        panelState: panelState as SessionPanelState | undefined,
        ...(permissionMode !== undefined ? { permissionMode } : {})
      })
    }

    if (isArchived !== undefined) {
      const updatedIds = db.updateSessionArchivedWithChildren(id, isArchived)
      for (const updatedId of updatedIds) {
        const updatedSession = db.getSession(updatedId)
        if (updatedSession != null) {
          notifySessionUpdated(updatedId, updatedSession)
        }
      }
    }

    if (tags !== undefined) {
      db.updateSessionTags(id, tags)
      const updatedSession = db.getSession(id)
      if (updatedSession != null) {
        notifySessionUpdated(id, updatedSession)
      }
    }

    ctx.body = { ok: true }
  })

  router.post(['/', ''], async (ctx) => {
    const {
      id,
      title,
      initialMessage,
      initialContent,
      parentSessionId,
      start,
      model,
      effort,
      fastMode,
      promptType,
      promptName,
      permissionMode,
      adapter,
      account,
      tags,
      updateSkills,
      workspace
    } = ctx.request.body as {
      id?: string
      title?: string
      initialMessage?: string
      initialContent?: ChatMessageContent[]
      parentSessionId?: string
      start?: boolean
      model?: string
      effort?: EffortLevel
      fastMode?: boolean
      promptType?: SessionPromptType
      promptName?: string
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
          name?: string
          kind?: GitBranchKind
          mode?: 'checkout' | 'create'
        }
      }
    }
    let session: Awaited<ReturnType<typeof createSessionWithInitialMessage>>
    try {
      session = await createSessionWithInitialMessage({
        title,
        initialMessage,
        initialContent,
        parentSessionId,
        id,
        shouldStart: start !== false,
        onWorkspaceProgress: (sessionId, progress) => notifySessionCreationProgress(sessionId, progress),
        model,
        effort,
        fastMode,
        promptType,
        promptName,
        permissionMode,
        adapter,
        account,
        tags: normalizeTags(tags),
        updateSkills: updateSkills === true,
        workspace: workspace == null
          ? undefined
          : {
            sourceSessionId: workspace.sourceSessionId,
            createWorktree: workspace.createWorktree,
            worktreeEnvironment: workspace.worktreeEnvironment,
            branch: workspace.branch?.name?.trim()
              ? {
                name: workspace.branch.name.trim(),
                kind: workspace.branch.kind,
                mode: workspace.branch.mode
              }
              : undefined
          }
      })
    } catch (error) {
      if (isSessionCreationCancelledError(error)) {
        throw conflict(
          'Session creation cancelled',
          { id },
          'session_creation_cancelled'
        )
      }
      throw error
    }
    ctx.body = {
      session: publicSession(session, session.id, responseContext(ctx))
    }
  })

  router.post('/:id/terminate', async (ctx) => {
    const { id } = ctx.params as { id: string }
    const existingSession = db.getSession(id)
    const creationCancellation = cancelSessionCreation(id, {
      recordPending: existingSession == null
    })
    const termination = existingSession == null && creationCancellation !== 'active'
      ? {
        accepted: true,
        delivery: 'creation_pending' as const
      }
      : await requestSessionTermination(id)

    if (!termination.accepted && creationCancellation !== 'active') {
      throw conflict(
        'Session runtime is not reachable',
        { id, delivery: termination.delivery },
        'session_runtime_not_reachable'
      )
    }

    ctx.body = {
      ok: true,
      creationCancellation,
      termination
    }
  })

  router.post('/:id/events', async (ctx) => {
    const { id } = ctx.params as { id: string }
    const existing = db.getSession(id)
    if (existing == null) {
      throw notFound('Session not found', { id }, 'session_not_found')
    }

    const body = ctx.request.body as {
      type?: string
      data?: any
      message?: ChatMessage | string
      summary?: string
      leafUuid?: string
      id?: string
      payload?: any
      exitCode?: number
      stderr?: string
    }

    const onSessionUpdated = (session: any) => {
      notifySessionUpdated(id, session)
    }

    if (body.type === 'message' && body.data != null) {
      const event: WSEvent = { type: 'message', message: body.data }
      applySessionEvent(id, event, {
        broadcast: (ev) => broadcastSessionEvent(id, ev),
        onSessionUpdated
      })
      ctx.body = { ok: true }
      return
    }

    if (body.type === 'message' && body.message != null && typeof body.message !== 'string') {
      const event: WSEvent = { type: 'message', message: body.message }
      applySessionEvent(id, event, {
        broadcast: (ev) => broadcastSessionEvent(id, ev),
        onSessionUpdated
      })
      ctx.body = { ok: true }
      return
    }

    if (body.type === 'summary' && body.data?.summary) {
      const info: SessionInfo = {
        type: 'summary',
        summary: body.data.summary,
        leafUuid: body.data.leafUuid ?? ''
      }
      const event: WSEvent = { type: 'session_info', info }
      applySessionEvent(id, event, {
        broadcast: (ev) => broadcastSessionEvent(id, ev),
        onSessionUpdated
      })
      ctx.body = { ok: true }
      return
    }

    if (body.type === 'summary' && typeof body.summary === 'string') {
      const info: SessionInfo = {
        type: 'summary',
        summary: body.summary,
        leafUuid: body.leafUuid ?? ''
      }
      const event: WSEvent = { type: 'session_info', info }
      applySessionEvent(id, event, {
        broadcast: (ev) => broadcastSessionEvent(id, ev),
        onSessionUpdated
      })
      ctx.body = { ok: true }
      return
    }

    if (body.type === 'init' && body.data) {
      const infoData = body.data as SessionInitInfo
      const info: SessionInfo = {
        ...infoData,
        type: 'init'
      }
      const event: WSEvent = { type: 'session_info', info }
      applySessionEvent(id, event, {
        broadcast: (ev) => broadcastSessionEvent(id, ev),
        onSessionUpdated
      })
      ctx.body = { ok: true }
      return
    }

    if (body.type === 'interaction_request' && body.id && body.payload) {
      const event = projectAndSetSessionInteraction(
        id,
        { id: body.id, payload: body.payload },
        createPublicProjectionContext()
      )
      if (event == null) {
        throw badRequest(
          'Invalid interaction request payload',
          undefined,
          'invalid_interaction_request'
        )
      }
      applySessionEvent(id, event, {
        broadcast: (ev) => broadcastSessionEvent(id, ev),
        onSessionUpdated
      })
      ctx.body = { ok: true }
      return
    }

    if (body.type === 'interaction_response' && body.id && body.data != null) {
      const handled = await handleInteractionResponse(id, body.id, body.data)
      if (!handled) {
        throw conflict(
          'Interaction response is no longer pending',
          { id: body.id },
          'interaction_not_pending'
        )
      }
      ctx.body = { ok: true }
      return
    }

    if (body.type === 'adapter_event' && body.data != null) {
      const data = sanitizePublicAdapterEventData(
        body.data,
        id,
        db.getSessionWorkspace(id)?.workspaceFolder,
        existing.adapter,
        createPublicProjectionContext()
      )
      if (data == null) {
        throw badRequest(
          'Invalid adapter event payload',
          undefined,
          'invalid_adapter_event'
        )
      }
      const event: WSEvent = {
        type: 'adapter_event',
        data
      }
      applySessionEvent(id, event, {
        broadcast: (ev) => broadcastSessionEvent(id, ev),
        onSessionUpdated
      })
      ctx.body = { ok: true }
      return
    }

    if (body.type === 'error' && body.data?.message) {
      const event: WSEvent = {
        type: 'error',
        data: body.data,
        message: body.data.message
      }
      applySessionEvent(id, event, {
        broadcast: (ev) => broadcastSessionEvent(id, ev),
        onSessionUpdated
      })
      ctx.body = { ok: true }
      return
    }

    if (body.type === 'error' && typeof body.message === 'string') {
      const event: WSEvent = {
        type: 'error',
        data: {
          message: body.message,
          fatal: true
        },
        message: body.message
      }
      applySessionEvent(id, event, {
        broadcast: (ev) => broadcastSessionEvent(id, ev),
        onSessionUpdated
      })
      ctx.body = { ok: true }
      return
    }

    if (body.type === 'exit') {
      const exitCode = Number(body.data?.exitCode ?? body.exitCode ?? 0)
      void finalizeSessionWorkspaceChangeTracking(id, exitCode === 0 ? 'completed' : 'failed')
      if (exitCode === 0) {
        updateAndNotifySession(id, { status: 'completed' })
      } else {
        const stderr = body.data?.stderr ?? body.stderr ?? ''
        const latestSession = db.getSession(id)
        if (latestSession?.status !== 'failed') {
          const message = stderr !== ''
            ? `Process exited with code ${exitCode}, stderr:\n${stderr}`
            : `Process exited with code ${exitCode}`
          const event: WSEvent = {
            type: 'error',
            data: {
              message,
              details: stderr !== '' ? { stderr } : undefined,
              fatal: true
            },
            message
          }
          applySessionEvent(id, event, {
            broadcast: (ev) => broadcastSessionEvent(id, ev),
            onSessionUpdated
          })
        }
      }
      ctx.body = { ok: true }
      return
    }

    if (body.type === 'stop') {
      const latestSession = db.getSession(id)
      void finalizeSessionWorkspaceChangeTracking(
        id,
        latestSession?.status === 'failed' ? 'failed' : 'completed'
      )
      if (latestSession?.status !== 'failed') {
        updateAndNotifySession(id, { status: 'completed' })
      }
      ctx.body = { ok: true }
      return
    }

    throw badRequest('Invalid event', { type: body.type }, 'invalid_event')
  })

  router.delete('/:id', async (ctx) => {
    const { id } = ctx.params as { id: string }
    const { force } = ctx.query as { force?: string }
    const workspace = db.getSessionWorkspace(id)

    // 显式销毁会话进程，避免 worktree 删除时仍被占用
    killSession(id, { recordWorkspaceChanges: false })
    disposeTerminalSession(id)
    await deleteRuntimeSessionStores({
      cwd: workspace?.workspaceFolder,
      sessionId: id
    })

    await deleteSessionWorkspace(id, {
      force: force === 'true'
    })

    db.deleteChannelSessionBySessionId(id)
    const removed = db.deleteSession(id)
    if (removed) {
      notifySessionUpdated(id, { id, isDeleted: true })
    }
    ctx.body = { ok: true, removed }
  })

  router.post('/:id/queued-messages', (ctx) => {
    const { id } = ctx.params as { id: string }
    const plan = parseSessionQueueCreateRequest(ctx.request.body)
    if (plan == null) {
      throw badRequest('Queued message content cannot be empty', undefined, 'empty_queued_message_content')
    }

    const session = db.getSession(id)
    if (session == null) {
      throw notFound('Session not found', { id }, 'session_not_found')
    }

    const queuedMessage = createSessionQueuedMessage(id, plan.mode, plan.content)
    ctx.body = {
      queuedMessage: sanitizePublicQueuedSessionMessage(queuedMessage, id, responseContext(ctx)),
      queuedMessages: publicQueuedMessages(id, responseContext(ctx))
    }
  })

  router.patch('/:id/queued-messages/:queueId', (ctx) => {
    const { id, queueId } = ctx.params as { id: string; queueId: string }
    const plan = parseSessionQueueUpdateRequest(ctx.request.body)
    if (plan == null) {
      throw badRequest('Queued message content cannot be empty', undefined, 'empty_queued_message_content')
    }

    const updated = updateSessionQueuedMessage(id, queueId, plan.content)
    if (updated == null) {
      throw notFound('Queued message not found', { id, queueId }, 'queued_message_not_found')
    }

    ctx.body = {
      queuedMessage: sanitizePublicQueuedSessionMessage(updated, id, responseContext(ctx)),
      queuedMessages: publicQueuedMessages(id, responseContext(ctx))
    }
  })

  router.delete('/:id/queued-messages/:queueId', (ctx) => {
    const { id, queueId } = ctx.params as { id: string; queueId: string }
    const removed = deleteSessionQueuedMessage(id, queueId)
    if (!removed) {
      throw notFound('Queued message not found', { id, queueId }, 'queued_message_not_found')
    }
    ctx.body = { ok: true, queuedMessages: publicQueuedMessages(id, responseContext(ctx)) }
  })

  router.post('/:id/queued-messages/:queueId/move', (ctx) => {
    const { id, queueId } = ctx.params as { id: string; queueId: string }
    const plan = parseSessionQueueMoveRequest(ctx.request.body)
    if (plan == null) {
      throw badRequest('Invalid queued message mode', undefined, 'invalid_queued_message_mode')
    }

    const moved = moveSessionQueuedMessage(id, queueId, plan.mode)
    if (moved == null) {
      throw notFound('Queued message not found', { id, queueId }, 'queued_message_not_found')
    }

    ctx.body = {
      queuedMessage: sanitizePublicQueuedSessionMessage(moved, id, responseContext(ctx)),
      queuedMessages: publicQueuedMessages(id, responseContext(ctx))
    }
  })

  router.post('/:id/queued-messages/reorder', (ctx) => {
    const { id } = ctx.params as { id: string }
    const plan = parseSessionQueueReorderRequest(ctx.request.body)
    if (plan == null) {
      throw badRequest('Invalid queued message order', undefined, 'invalid_queued_message_order')
    }

    try {
      reorderSessionQueuedMessages(id, plan.mode, plan.ids)
    } catch (error) {
      throw badRequest('Invalid queued message order', undefined, 'invalid_queued_message_order')
    }

    ctx.body = { queuedMessages: publicQueuedMessages(id, responseContext(ctx)) }
  })

  router.post('/:id/messages/:messageId/branch', async (ctx) => {
    const { id, messageId } = ctx.params as { id: string; messageId: string }
    const { action, content, title } = ctx.request.body as {
      action?: 'fork' | 'recall' | 'edit'
      content?: string | ChatMessageContent[]
      title?: string
    }

    if (action !== 'fork' && action !== 'recall' && action !== 'edit') {
      throw badRequest('Invalid message action', { action }, 'invalid_message_action')
    }

    const branchResult = await branchSessionFromMessage({
      sessionId: id,
      messageId,
      action,
      content,
      title
    })

    if (branchResult.replayContent != null) {
      const replayMessage = summarizeRuntimeSessionContent(branchResult.replayContent)
      const workspace = await resolveSessionWorkspace(branchResult.session.id)
      db.updateSessionRuntimeState(branchResult.session.id, { runtimeKind: 'external' })
      void createServerRuntimeSession({
        sessionId: branchResult.session.id,
        cwd: workspace.workspaceFolder,
        title: branchResult.session.title,
        content: branchResult.replayContent,
        message: replayMessage,
        model: branchResult.session.model,
        effort: branchResult.session.effort,
        fastMode: branchResult.session.fastMode,
        permissionMode: branchResult.session.permissionMode,
        adapter: branchResult.session.adapter,
        account: branchResult.session.account,
        promptType: branchResult.session.promptType,
        promptName: branchResult.session.promptName,
        systemPrompt: branchResult.historySeed
      }).catch((error) => {
        console.error('[sessions] failed to continue branched session:', error)
      })
    }

    const branchedSession = db.getSession(branchResult.session.id) ?? branchResult.session
    ctx.body = {
      session: publicSession(branchedSession, branchResult.session.id, responseContext(ctx))
    }
  })

  router.post('/:id/fork', async (ctx) => {
    const { id } = ctx.params as { id: string }
    const { title } = ctx.request.body as { title?: string }

    const original = db.getSession(id)
    if (!original) {
      throw notFound('Original session not found', { id }, 'original_session_not_found')
    }

    const originalEvents = db.getMessages(id) as WSEvent[]
    const historySeed = buildHistorySeedFromEvents(originalEvents)
    const newSession = db.createSession(
      (title != null && title !== '') ? title : `${original.title} (Fork)`,
      undefined,
      undefined,
      original.id,
      {
        runtimeKind: 'external',
        historySeed,
        historySeedPending: historySeed != null
      }
    )

    try {
      await provisionSessionWorkspace(newSession.id, {
        sourceSessionId: original.id
      })

      // 同步历史消息
      db.copyMessages(id, newSession.id)
      if (original.promptType !== undefined || original.promptName !== undefined) {
        db.updateSession(newSession.id, {
          promptType: original.promptType,
          promptName: original.promptName
        })
        const updatedSession = db.getSession(newSession.id)
        if (updatedSession != null) {
          Object.assign(newSession, updatedSession)
        }
      }
      const workspace = await resolveSessionWorkspace(newSession.id)
      const runtimeSession = db.getSession(newSession.id) ?? newSession
      await createServerRuntimeSession({
        sessionId: newSession.id,
        cwd: workspace.workspaceFolder,
        title: runtimeSession.title,
        model: runtimeSession.model,
        effort: runtimeSession.effort,
        fastMode: runtimeSession.fastMode,
        permissionMode: runtimeSession.permissionMode,
        adapter: runtimeSession.adapter,
        account: runtimeSession.account,
        promptType: runtimeSession.promptType,
        promptName: runtimeSession.promptName,
        systemPrompt: historySeed,
        start: false
      })
    } catch (error) {
      await deleteSessionWorkspace(newSession.id, { force: true }).catch(() => undefined)
      db.deleteSession(newSession.id)
      throw error
    }

    notifySessionUpdated(newSession.id, newSession)

    ctx.body = {
      session: publicSession(newSession, newSession.id, responseContext(ctx))
    }
  })

  router.all('/:id', (ctx) => {
    throw methodNotAllowed('Method Not Allowed', { path: ctx.path }, 'method_not_allowed')
  })

  return router
}
