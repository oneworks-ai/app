import { createHash, randomUUID } from 'node:crypto'

import { getDb } from '#~/db/index.js'
import type { ChannelRuntimeContext } from '#~/services/session/channel-context.js'
import { createSessionWithInitialMessage } from '#~/services/session/create.js'
import { writeChannelMessageContext } from '#~/services/session/index.js'

type ClaimedRows = ReturnType<ReturnType<typeof getDb>['claimChannelOffhourBacklog']>

const digestRunId = (ids: readonly string[]) => (
  `channel_offhour_digest_${createHash('sha256').update([...ids].sort().join('\0')).digest('hex').slice(0, 32)}`
)

const buildDigestMessage = (rows: ClaimedRows) =>
  [
    'Off-hours channel backlog digest. Review these messages and respond only where appropriate:',
    ...rows.map(row =>
      `- ${new Date(row.createdAt).toISOString()} ${row.senderId ?? 'unknown'}: ${row.text ?? '[no text]'}`
    )
  ].join('\n')

const defaultDispatch = async (
  input: { childRunId: string; channelContext?: ChannelRuntimeContext; rows: ClaimedRows }
) => {
  const db = getDb()
  const sessionId = `${input.childRunId}_session`
  const existing = db.getSession(sessionId)
  if (existing?.status != null) return sessionId
  const first = input.rows[0]!
  const channelContext: ChannelRuntimeContext = {
    ...input.channelContext,
    channelId: first.channelId,
    channelKey: first.channelKey,
    channelLinkName: first.channelLinkName ?? undefined,
    channelType: first.channelType,
    childRunId: input.childRunId,
    entity: first.entity ?? undefined,
    messageId: first.messageId ?? undefined,
    senderId: first.senderId ?? undefined,
    sessionType: first.sessionType,
    threadKey: `offhour-digest:${first.channelLinkName ?? first.channelKey}`
  }
  const session = await createSessionWithInitialMessage({
    channelContext,
    beforeStart: async createdSessionId => await writeChannelMessageContext(createdSessionId, channelContext),
    id: sessionId,
    initialMessage: buildDigestMessage(input.rows),
    promptName: first.entity ?? undefined,
    promptType: first.entity == null ? undefined : 'entity',
    shouldStart: true,
    title: `Off-hours digest ${first.channelLinkName ?? first.channelKey}`,
    workspace: { createWorktree: false }
  })
  return session.id
}

export const processOffhourBacklogDigest = async (input: {
  channelContext?: ChannelRuntimeContext
  channelId?: string
  channelKey?: string
  channelLinkName?: string
  channelType?: string
  dispatch?: (input: { childRunId: string; rows: ClaimedRows }) => Promise<string>
  entity?: string
  leaseMs?: number
  leaseOwner?: string
  limit?: number
  now?: number
  sessionType?: string
}) => {
  const db = getDb()
  const leaseOwner = input.leaseOwner ?? `offhour-digest:${randomUUID()}`
  const rows = db.claimChannelOffhourBacklog({
    filter: {
      channelId: input.channelId,
      channelKey: input.channelKey,
      channelLinkName: input.channelLinkName,
      channelType: input.channelType,
      entity: input.entity,
      limit: input.limit,
      sessionType: input.sessionType
    },
    leaseMs: input.leaseMs ?? 5 * 60 * 1000,
    leaseOwner,
    now: input.now
  })
  if (rows.length === 0) return { claimed: 0, childRunId: undefined, processed: 0 }

  const ids = rows.map(row => row.id)
  const childRunId = rows.find(row => row.digestChildRunId != null)?.digestChildRunId ?? digestRunId(ids)
  try {
    let run = db.getChannelChildSessionRun(childRunId)
    if (run == null) {
      const first = rows[0]!
      run = db.createChannelChildSessionRun({
        actorAccountId: first.senderId,
        actorUserId: first.actorUserId,
        channelId: first.channelId,
        channelKey: first.channelKey,
        channelLinkName: first.channelLinkName,
        channelType: first.channelType,
        dispatchMode: 'create_session',
        entity: first.entity,
        id: childRunId,
        metadata: { backlogIds: ids, leaseOwner, source: 'offhour_backlog_digest' },
        senderId: first.senderId,
        sessionType: first.sessionType,
        threadKey: `offhour-digest:${first.channelLinkName ?? first.channelKey}`,
        triggerType: 'message_batch'
      })
    }
    if (run == null) throw new Error('failed to create off-hours digest child run')
    const attached = db.attachChannelOffhourBacklogDigestChildRun({ digestChildRunId: childRunId, ids, leaseOwner })
    if (attached !== ids.length) throw new Error('off-hours digest lease lost before child-run attachment')

    let sessionId = run.sessionId
    if (run.status !== 'dispatched' && run.status !== 'running') {
      sessionId = await (input.dispatch ?? (value =>
        defaultDispatch({ ...value, channelContext: input.channelContext })))({
          childRunId,
          rows
        })
      db.markChannelChildSessionRunDispatched(childRunId, { sessionId })
      db.markChannelChildSessionRunRunning(childRunId)
    }
    if (sessionId == null) throw new Error('off-hours digest did not enter a recoverable dispatched state')
    const processed = db.completeChannelOffhourBacklogClaim({ ids, leaseOwner })
    return { claimed: rows.length, childRunId, processed }
  } catch (error) {
    db.retryChannelOffhourBacklogClaim({
      error: error instanceof Error ? error.message : String(error),
      ids,
      leaseOwner
    })
    throw error
  }
}
