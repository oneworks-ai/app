import type { AgentRoomChannelConnection, AgentRoomCommand } from '@oneworks/core'

import type { AgentRoomOwnerDependencies } from './owner.js'

type AgentRoomDb = NonNullable<AgentRoomOwnerDependencies['db']>
type ChannelCommand = Extract<
  AgentRoomCommand,
  { type: 'attach_member_channel' | 'update_member_channel' }
>

export const executeAgentRoomChannelCommand = async (
  db: AgentRoomDb,
  dependencies: AgentRoomOwnerDependencies,
  roomId: string,
  command: ChannelCommand
) => {
  if (command.type === 'attach_member_channel') {
    if (dependencies.resolveChannelConnection == null) {
      throw new Error('Agent room owner does not support ChannelLink attachment')
    }
    const member = db.getAgentRoomMember(roomId, command.connection.memberKey)
    if (member == null) throw new Error(`Agent room member not found: ${command.connection.memberKey}`)
    const resolved = await dependencies.resolveChannelConnection(command.connection.channelLinkName)
    if (member.kind !== 'entity' || (member.key !== resolved.entity && member.key !== `entity:${resolved.entity}`)) {
      throw new Error(`ChannelLink ${resolved.channelLinkName} does not belong to ${member.key}`)
    }
    const link = db.saveAgentRoomChannelConnection({
      ...resolved,
      roomId,
      memberKey: member.key,
      muted: command.connection.muted ?? false,
      requireMention: command.connection.requireMention ?? false,
      ...(command.connection.commandPrefix != null ? { commandPrefix: command.connection.commandPrefix } : {})
    })
    db.appendAgentRoomEvent({
      idempotencyKey: command.idempotencyKey,
      payload: link,
      roomId,
      type: command.type
    })
    return link
  }

  const existing = db.listAgentRoomChannelConnectionsForMember(roomId, command.connection.memberKey)
    .find(item => item.channelLinkName === command.connection.channelLinkName)
  if (existing == null) {
    throw new Error(`Agent room member channel not found: ${command.connection.channelLinkName}`)
  }
  const link: AgentRoomChannelConnection = db.saveAgentRoomChannelConnection({
    ...existing,
    ...(command.connection.commandPrefix === null ? { commandPrefix: undefined } : {}),
    ...(command.connection.commandPrefix != null ? { commandPrefix: command.connection.commandPrefix } : {}),
    ...(command.connection.muted != null ? { muted: command.connection.muted } : {}),
    ...(command.connection.requireMention != null ? { requireMention: command.connection.requireMention } : {}),
    ...(command.connection.status != null ? { status: command.connection.status } : {}),
    updatedAt: Date.now()
  })
  db.appendAgentRoomEvent({
    idempotencyKey: command.idempotencyKey,
    payload: link,
    roomId,
    type: command.type
  })
  return link
}
