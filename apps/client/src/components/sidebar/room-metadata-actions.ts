import type { UpdateAgentRoomMetadataRequest, UpdateAgentRoomMetadataResponse } from '@oneworks/core'

import { updateAgentRoomMetadata } from '#~/api/agent-rooms'

export async function updateSidebarRoomMetadata({
  mutateRooms,
  request,
  roomId,
  updateMetadata = updateAgentRoomMetadata
}: {
  mutateRooms: () => Promise<unknown> | unknown
  request: UpdateAgentRoomMetadataRequest
  roomId: string
  updateMetadata?: (
    roomId: string,
    request: UpdateAgentRoomMetadataRequest
  ) => Promise<UpdateAgentRoomMetadataResponse>
}): Promise<void> {
  await updateMetadata(roomId, request)
  await mutateRooms()
}
