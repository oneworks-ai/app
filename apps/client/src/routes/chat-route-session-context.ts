import type { Session } from '@oneworks/core'

export const mergeChatRouteSessions = (
  activeSessions: Session[] | undefined,
  archivedSessions: Session[] | undefined,
  extraSessions: Array<Session | undefined>
) => {
  const sessionMap = new Map<string, Session>()
  for (const item of [...(activeSessions ?? []), ...(archivedSessions ?? []), ...extraSessions]) {
    if (item != null && item.id !== '') {
      sessionMap.set(item.id, item)
    }
  }
  return [...sessionMap.values()]
}
