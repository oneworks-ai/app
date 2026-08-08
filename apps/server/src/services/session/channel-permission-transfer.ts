import type { SessionChannelActorSnapshot } from '#~/db/index.js'

interface ChannelPermissionActor {
  actorAccountId?: string
  actorUserId?: string
  channelKey?: string
  senderId?: string
}

const resolveActorKey = (actor: ChannelPermissionActor) => {
  const userId = actor.actorUserId?.trim()
  if (userId != null && userId !== '') return `user:${userId}`
  const accountId = actor.actorAccountId?.trim() || actor.senderId?.trim()
  return accountId == null || accountId === '' ? undefined : `account:${accountId}`
}

export const canTransferChannelPermissionState = (
  parent: SessionChannelActorSnapshot | undefined,
  child: ChannelPermissionActor
) => (
  parent?.channelKey != null &&
  parent.channelKey === child.channelKey &&
  resolveActorKey(parent) != null &&
  resolveActorKey(parent) === resolveActorKey(child)
)
