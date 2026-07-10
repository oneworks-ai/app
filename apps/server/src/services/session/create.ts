/* eslint-disable max-lines -- session creation coordinates metadata, workspace provisioning, and runtime startup. */
import type { ChatMessageContent, EffortLevel, Session } from '@oneworks/core'
import type { GitBranchKind, SessionCreationProgressEvent, SessionPromptType } from '@oneworks/types'

import { getDb } from '#~/db/index.js'
import { getWorkspaceFolder, loadConfigState } from '#~/services/config/index.js'
import { checkoutSessionGitBranch, createSessionGitBranch } from '#~/services/git/index.js'
import { projectRuntimeCommand } from '#~/services/runtime-store/session-command-projection.js'
import {
  createServerRuntimeSession,
  summarizeRuntimeSessionContent
} from '#~/services/runtime-store/session-control.js'
import type { ChannelRuntimeContext } from '#~/services/session/channel-context.js'
import {
  registerSessionCreationCancellation,
  throwIfSessionCreationCancelled
} from '#~/services/session/creation-cancellation.js'
import { notifySessionUpdated } from '#~/services/session/runtime.js'
import {
  deleteSessionWorkspace,
  provisionSessionWorkspace,
  resolveSessionWorkspace
} from '#~/services/session/workspace.js'

interface CreateSessionWorkspaceBranchOptions {
  name: string
  kind?: GitBranchKind
  mode?: 'checkout' | 'create'
}

interface CreateSessionWorkspaceOptions {
  sourceSessionId?: string
  createWorktree?: boolean
  worktreeEnvironment?: string
  branch?: CreateSessionWorkspaceBranchOptions
}

const resolveCreateSessionConfigWorkspaceFolder = async (sourceSessionId?: string) => {
  if (sourceSessionId != null && sourceSessionId !== '') {
    const workspace = await resolveSessionWorkspace(sourceSessionId)
    return workspace.workspaceFolder
  }

  return getWorkspaceFolder()
}

const resolveCreateSessionWorktreeDefault = async (
  parentSessionId?: string,
  workspace?: CreateSessionWorkspaceOptions
) => {
  if (workspace?.createWorktree != null) {
    return workspace.createWorktree
  }

  const workspaceFolder = await resolveCreateSessionConfigWorkspaceFolder(workspace?.sourceSessionId ?? parentSessionId)
  const { mergedConfig } = await loadConfigState(workspaceFolder)
    .catch(() => ({ mergedConfig: {} as { conversation?: { createSessionWorktree?: boolean } } }))

  return mergedConfig.conversation?.createSessionWorktree ?? false
}

export async function createSessionWithInitialMessage(options: {
  title?: string
  initialMessage?: string
  initialContent?: ChatMessageContent[]
  initialRuntimeContent?: string | ChatMessageContent[]
  parentSessionId?: string
  id?: string
  shouldStart?: boolean
  beforeStart?: (sessionId: string) => void | Promise<void>
  onWorkspaceProgress?: (sessionId: string, progress: SessionCreationProgressEvent) => void | Promise<void>
  tags?: string[]
  model?: string
  effort?: EffortLevel
  fastMode?: boolean
  promptType?: SessionPromptType
  promptName?: string
  permissionMode?: 'default' | 'acceptEdits' | 'plan' | 'dontAsk' | 'bypassPermissions'
  systemPrompt?: string
  adapter?: string
  account?: string
  channelContext?: ChannelRuntimeContext
  updateSkills?: boolean
  workspace?: CreateSessionWorkspaceOptions
}): Promise<Session> {
  const {
    title,
    initialMessage,
    initialContent,
    initialRuntimeContent,
    parentSessionId,
    id,
    shouldStart = true,
    beforeStart,
    onWorkspaceProgress,
    tags,
    model,
    effort,
    fastMode,
    promptType,
    promptName,
    permissionMode,
    systemPrompt,
    adapter,
    account,
    channelContext,
    updateSkills,
    workspace
  } = options
  const db = getDb()
  const creationCancellationId = id ?? `session-creation-${Date.now()}-${Math.random().toString(16).slice(2)}`
  const creationCancellation = registerSessionCreationCancellation(creationCancellationId)
  let session: Session | undefined

  try {
    throwIfSessionCreationCancelled(creationCancellationId, creationCancellation.signal)
    session = db.createSession(title, id, undefined, parentSessionId, {
      runtimeKind: 'interactive'
    })
    if (
      model !== undefined ||
      effort !== undefined ||
      fastMode !== undefined ||
      permissionMode !== undefined ||
      adapter !== undefined ||
      account !== undefined ||
      promptType !== undefined ||
      promptName !== undefined
    ) {
      db.updateSession(session.id, {
        model,
        effort,
        fastMode,
        permissionMode,
        adapter,
        account,
        promptType,
        promptName
      })
      const updatedSession = db.getSession(session.id)
      if (updatedSession) {
        Object.assign(session, updatedSession)
      }
    }

    if (tags && tags.length > 0) {
      db.updateSessionTags(session.id, tags)
      const updated = db.getSession(session.id)
      if (updated) {
        Object.assign(session, updated)
      }
    }

    throwIfSessionCreationCancelled(session.id, creationCancellation.signal)
    const sessionId = session.id
    const createWorktree = await resolveCreateSessionWorktreeDefault(parentSessionId, workspace)
    throwIfSessionCreationCancelled(sessionId, creationCancellation.signal)
    await provisionSessionWorkspace(sessionId, {
      sourceSessionId: workspace?.sourceSessionId ?? parentSessionId,
      createWorktree,
      worktreeEnvironment: workspace?.worktreeEnvironment,
      signal: creationCancellation.signal,
      ...(onWorkspaceProgress == null
        ? {}
        : { onProgress: progress => onWorkspaceProgress(sessionId, progress) })
    })
    throwIfSessionCreationCancelled(sessionId, creationCancellation.signal)

    if (workspace?.branch != null) {
      const branchName = workspace.branch.name.trim()
      if (branchName !== '') {
        if (workspace.branch.mode === 'create') {
          await createSessionGitBranch(session.id, branchName)
        } else {
          await checkoutSessionGitBranch(session.id, {
            name: branchName,
            kind: workspace.branch.kind ?? 'local'
          })
        }
        throwIfSessionCreationCancelled(session.id, creationCancellation.signal)
      }
    }

    notifySessionUpdated(session.id, session)

    if ((initialMessage || initialContent) && shouldStart) {
      await beforeStart?.(session.id)
      throwIfSessionCreationCancelled(session.id, creationCancellation.signal)
      const workspace = await resolveSessionWorkspace(session.id)
      throwIfSessionCreationCancelled(session.id, creationCancellation.signal)
      const initialDisplayContent = initialContent ?? initialMessage
      const initialAgentContent = initialRuntimeContent ?? initialDisplayContent
      const initialText = initialDisplayContent == null
        ? ''
        : summarizeRuntimeSessionContent(initialDisplayContent)
      if (initialDisplayContent != null && (Array.isArray(initialDisplayContent) || initialText !== '')) {
        db.updateSessionRuntimeState(session.id, { runtimeKind: 'external' })
        throwIfSessionCreationCancelled(session.id, creationCancellation.signal)
        const runtimeSession = await createServerRuntimeSession({
          sessionId: session.id,
          cwd: workspace.workspaceFolder,
          title,
          content: initialDisplayContent,
          message: initialText,
          runtimeContent: initialAgentContent,
          model,
          effort,
          fastMode,
          permissionMode,
          systemPrompt,
          adapter,
          account,
          ...(channelContext == null ? {} : { channelContext }),
          promptType,
          promptName,
          updateConfiguredSkills: updateSkills === true
        })
        if (runtimeSession?.startCommand != null) {
          projectRuntimeCommand(db, runtimeSession.startCommand, true)
        }
        throwIfSessionCreationCancelled(session.id, creationCancellation.signal)
      }

      const updated = db.getSession(session.id)
      if (updated) {
        Object.assign(session, updated)
      }
    }

    return session
  } catch (err) {
    if (session != null) {
      await deleteSessionWorkspace(session.id, { force: true }).catch(() => undefined)
      db.deleteSession(session.id)
    }
    throw err
  } finally {
    creationCancellation.unregister()
  }
}
