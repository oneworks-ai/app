import type { ChannelConversationAvailabilityEvent } from '@oneworks/core/channel'

import { getDb } from '#~/db/index.js'
import { publishClientEvent } from '#~/services/client-events.js'

export const updateAgentRoomConnectionAvailability = (
  channelKey: string,
  event: ChannelConversationAvailabilityEvent
) => {
  const db = getDb()
  const connections = db.findAgentRoomChannelConnections({
    channelId: event.channelId,
    channelKey,
    channelType: event.channelType
  }).filter(connection => connection.status !== 'removed')
  const now = Date.now()
  const roomIds = new Set<string>()
  for (const connection of connections) {
    db.saveAgentRoomChannelConnection({
      ...connection,
      ...(event.status === 'active' ? { lastError: undefined, lastSeenAt: now } : { lastError: event.reason }),
      status: event.status,
      updatedAt: now
    })
    roomIds.add(connection.roomId)
  }
  for (const roomId of roomIds) {
    publishClientEvent('agent-rooms', { roomId, type: 'agent_room_updated' })
  }
  return connections.length
}
