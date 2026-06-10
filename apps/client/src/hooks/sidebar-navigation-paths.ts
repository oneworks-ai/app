import { matchPath } from 'react-router-dom'

import { getRoomSidebarId } from '#~/components/sidebar/conversation-items'

export const SESSION_ROUTE_PATTERN = '/session/:sessionId'
export const ROOM_ROUTE_PATTERN = '/rooms/:roomId'
export const ROOM_SESSION_ROUTE_PATTERN = '/rooms/:roomId/sessions/:sessionId'

export const getActiveSidebarIdFromPath = (pathname: string) => {
  if (pathname === '/') return ''

  const roomSessionMatch = matchPath({ path: ROOM_SESSION_ROUTE_PATTERN, end: true }, pathname)
  if (roomSessionMatch?.params.roomId != null) {
    return getRoomSidebarId(roomSessionMatch.params.roomId)
  }

  const roomMatch = matchPath({ path: ROOM_ROUTE_PATTERN, end: true }, pathname)
  if (roomMatch?.params.roomId != null) {
    return getRoomSidebarId(roomMatch.params.roomId)
  }

  const sessionMatch = matchPath({ path: SESSION_ROUTE_PATTERN, end: true }, pathname)
  return sessionMatch?.params.sessionId
}
