export const buildAgentRoomPath = (roomId: string) => `/rooms/${encodeURIComponent(roomId)}`

export const buildAgentRoomSessionPath = (roomId: string, sessionId: string) =>
  `${buildAgentRoomPath(roomId)}/sessions/${encodeURIComponent(sessionId)}`

export const AGENT_ROOM_SESSION_MODE_QUERY = 'agentRoomMode'
export const AGENT_ROOM_SESSION_MODE_VALUE = 'session'

export const buildSearchString = (searchParams: URLSearchParams) => {
  const search = searchParams.toString()
  return search === '' ? '' : `?${search}`
}

export const buildAgentRoomArchiveExitTarget = (searchParams: URLSearchParams) => {
  const nextParams = new URLSearchParams(searchParams)
  nextParams.delete(AGENT_ROOM_SESSION_MODE_QUERY)
  return {
    pathname: '/',
    search: buildSearchString(nextParams)
  }
}
