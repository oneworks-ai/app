import type { ChannelInboundEvent } from '@oneworks/core/channel'

import { getDb } from '#~/db/index.js'
import { createServerAdapterAccountContext, isMissingAdapterPackageError } from '#~/services/adapter-accounts.js'
import { killSession, startAdapterSession } from '#~/services/session/index.js'
import { notifySessionUpdated } from '#~/services/session/runtime.js'
import { resolveSessionWorkspace } from '#~/services/session/workspace.js'

import type { ChannelContext } from './middleware/@types'
import { bindChannelSession } from './middleware/bind-session'
import { deleteBinding } from './state'

type SessionOperations = Pick<
  ChannelContext,
  | 'getBoundSession'
  | 'searchSessions'
  | 'bindSession'
  | 'unbindSession'
  | 'resetSession'
  | 'stopSession'
  | 'restartSession'
  | 'resolveSessionWorkspace'
  | 'getBoundSessionAccountDetail'
  | 'updateSession'
>

const matchesSessionSearch = (session: ReturnType<ReturnType<typeof getDb>['getSession']>, query: string) => {
  const normalizedQuery = query.trim().toLowerCase()
  if (normalizedQuery === '') return true
  return [
    session?.id,
    session?.title,
    session?.lastMessage,
    session?.lastUserMessage,
    session?.model,
    session?.adapter,
    ...(session?.tags ?? [])
  ]
    .filter((value): value is string => typeof value === 'string' && value.trim() !== '')
    .join('\n')
    .toLowerCase()
    .includes(normalizedQuery)
}

const toBindingInfo = (binding: NonNullable<ReturnType<ReturnType<typeof getDb>['getChannelSessionBySessionId']>>) => ({
  channelType: binding.channelType,
  sessionType: binding.sessionType,
  channelId: binding.channelId,
  channelKey: binding.channelKey
})

export const createOfflineSessionOperations = (
  getContext: () => ChannelContext,
  channelKey: string,
  inbound: ChannelInboundEvent
): SessionOperations => ({
  getBoundSession: () => {
    const sessionId = getContext().sessionId
    return sessionId == null ? undefined : getDb().getSession(sessionId)
  },
  searchSessions: (query) => {
    const db = getDb()
    return db.getSessions('all')
      .filter(session => matchesSessionSearch(session, query))
      .map(session => {
        const binding = db.getChannelSessionBySessionId(session.id)
        return { session, binding: binding == null ? undefined : toBindingInfo(binding) }
      })
  },
  bindSession: (nextSessionId) => {
    const session = getDb().getSession(nextSessionId)
    if (session == null) return { alreadyBound: false }
    const result = bindChannelSession({
      channelType: inbound.channelType,
      sessionType: inbound.sessionType,
      channelId: inbound.channelId,
      channelKey,
      senderId: inbound.senderId,
      replyReceiveId: inbound.replyTo?.receiveId,
      replyReceiveIdType: inbound.replyTo?.receiveIdType,
      sessionId: nextSessionId
    })
    if (result.previousSessionId != null && result.previousSessionId !== nextSessionId) {
      deleteBinding(result.previousSessionId)
    }
    getContext().sessionId = nextSessionId
    return {
      alreadyBound: result.alreadyBound,
      session,
      previousSessionId: result.previousSessionId,
      transferredFrom: result.transferredFrom == null ? undefined : toBindingInfo(result.transferredFrom)
    }
  },
  unbindSession: () => {
    const ctx = getContext()
    const current = getDb().getChannelSession(inbound.channelType, inbound.sessionType, inbound.channelId)
    const sessionId = current?.sessionId ?? ctx.sessionId
    getDb().deleteChannelSession(inbound.channelType, inbound.sessionType, inbound.channelId)
    if (sessionId != null) deleteBinding(sessionId)
    ctx.sessionId = undefined
    return { sessionId }
  },
  resetSession: () => {
    const ctx = getContext()
    if (ctx.sessionId == null) return
    const sessionId = ctx.sessionId
    for (const updatedId of getDb().updateSessionArchivedWithChildren(sessionId, true)) {
      const updatedSession = getDb().getSession(updatedId)
      if (updatedSession != null) notifySessionUpdated(updatedId, updatedSession)
    }
    getDb().deleteChannelSessionBySessionId(sessionId)
    deleteBinding(sessionId)
    ctx.sessionId = undefined
  },
  stopSession: () => {
    const sessionId = getContext().sessionId
    if (sessionId != null) killSession(sessionId)
  },
  restartSession: async () => {
    const sessionId = getContext().sessionId
    if (sessionId != null) {
      killSession(sessionId)
      await startAdapterSession(sessionId)
    }
  },
  resolveSessionWorkspace: async (targetSessionId) => {
    const sessionId = targetSessionId ?? getContext().sessionId
    return sessionId == null || sessionId === '' ? undefined : await resolveSessionWorkspace(sessionId)
  },
  getBoundSessionAccountDetail: async (options) => {
    const session = getContext().getBoundSession()
    const adapterKey = session?.adapter?.trim()
    const accountKey = session?.account?.trim()
    if (session == null || adapterKey == null || adapterKey === '' || accountKey == null || accountKey === '') {
      return undefined
    }
    try {
      const { adapter, adapterCtx } = await createServerAdapterAccountContext(adapterKey)
      if (adapter.getAccountDetail == null) return undefined
      const detail = await adapter.getAccountDetail(adapterCtx, {
        account: accountKey,
        model: session.model,
        refresh: options?.refresh
      })
      return detail.account
    } catch (error) {
      if (isMissingAdapterPackageError(error, adapterKey)) return undefined
      throw error
    }
  },
  updateSession: (updates) => {
    const sessionId = getContext().sessionId
    if (sessionId != null) getDb().updateSession(sessionId, updates)
  }
})
