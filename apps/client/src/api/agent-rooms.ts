import type {
  AgentRoomDetailResponse,
  AgentRoomInteractionResponseRequest,
  AgentRoomInteractionResponseResponse,
  AgentRoomListResponse,
  AgentRoomMessageWriteRequest,
  AgentRoomMessageWriteResponse,
  UpdateAgentRoomMetadataRequest,
  UpdateAgentRoomMetadataResponse
} from '@oneworks/core'

import { fetchApiJson, jsonHeaders } from './base'

export async function listAgentRooms(): Promise<AgentRoomListResponse> {
  return fetchApiJson<AgentRoomListResponse>('/api/agent-rooms')
}

export async function listArchivedAgentRooms(): Promise<AgentRoomListResponse> {
  return fetchApiJson<AgentRoomListResponse>('/api/agent-rooms/archived')
}

export async function getAgentRoom(roomId: string): Promise<AgentRoomDetailResponse> {
  return fetchApiJson<AgentRoomDetailResponse>(`/api/agent-rooms/${encodeURIComponent(roomId)}`)
}

export async function updateAgentRoomMetadata(
  roomId: string,
  request: UpdateAgentRoomMetadataRequest
): Promise<UpdateAgentRoomMetadataResponse> {
  return fetchApiJson<UpdateAgentRoomMetadataResponse>(`/api/agent-rooms/${encodeURIComponent(roomId)}`, {
    method: 'PATCH',
    headers: jsonHeaders,
    body: JSON.stringify(request)
  })
}

export async function postAgentRoomMessage(
  roomId: string,
  request: AgentRoomMessageWriteRequest
): Promise<AgentRoomMessageWriteResponse> {
  return fetchApiJson<AgentRoomMessageWriteResponse>(`/api/agent-rooms/${encodeURIComponent(roomId)}/messages`, {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify(request)
  })
}

export const sendAgentRoomMessage = postAgentRoomMessage

export async function respondAgentRoomInteraction(
  roomId: string,
  interactionId: string,
  request: AgentRoomInteractionResponseRequest
): Promise<AgentRoomInteractionResponseResponse> {
  return fetchApiJson<AgentRoomInteractionResponseResponse>(
    `/api/agent-rooms/${encodeURIComponent(roomId)}/interactions/${encodeURIComponent(interactionId)}/responses`,
    {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify(request)
    }
  )
}
