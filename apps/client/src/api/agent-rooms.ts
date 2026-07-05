import type {
  AgentRoomDetailResponse,
  AgentRoomHostSessionResponse,
  AgentRoomInteractionResponseRequest,
  AgentRoomInteractionResponseResponse,
  AgentRoomListResponse,
  AgentRoomMessageWriteRequest,
  AgentRoomMessageWriteResponse,
  AgentRoomSummaryListResponse,
  UpdateAgentRoomMetadataRequest,
  UpdateAgentRoomMetadataResponse
} from '@oneworks/core'

import { fetchApiJson, jsonHeaders } from './base'

export async function listAgentRooms(): Promise<AgentRoomListResponse> {
  return fetchApiJson<AgentRoomListResponse>('/api/agent-rooms')
}

export async function listAgentRoomSummaries(): Promise<AgentRoomSummaryListResponse> {
  return fetchApiJson<AgentRoomSummaryListResponse>('/api/agent-rooms/summary')
}

export async function listArchivedAgentRooms(): Promise<AgentRoomListResponse> {
  return fetchApiJson<AgentRoomListResponse>('/api/agent-rooms/archived')
}

export async function getAgentRoomByHostSession(sessionId: string): Promise<AgentRoomHostSessionResponse> {
  return fetchApiJson<AgentRoomHostSessionResponse>(
    `/api/agent-rooms/by-host-session/${encodeURIComponent(sessionId)}`
  )
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
