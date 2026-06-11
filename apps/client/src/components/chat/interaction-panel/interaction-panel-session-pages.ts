export interface InteractionPanelSessionPage {
  focusRequestId?: string
  id: string
  sessionId?: string
  title: string
}

const buildSessionPagesStorageKey = (sessionId: string) => `chatInteractionSessionPages:${sessionId}`

export const createInteractionPanelSessionPage = (
  title: string,
  sessionId?: string,
  focusRequestId?: string
): InteractionPanelSessionPage => ({
  id: `session-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
  ...(focusRequestId == null || focusRequestId.trim() === '' ? {} : { focusRequestId: focusRequestId.trim() }),
  ...(sessionId == null || sessionId.trim() === '' ? {} : { sessionId: sessionId.trim() }),
  title
})

const normalizeSessionPage = (page: InteractionPanelSessionPage): InteractionPanelSessionPage => {
  const sessionId = page.sessionId?.trim()
  return {
    id: page.id,
    title: page.title.trim() || sessionId || page.id,
    ...(sessionId == null || sessionId === '' ? {} : { sessionId })
  }
}

export const readInteractionPanelSessionPages = (sessionId: string): InteractionPanelSessionPage[] => {
  if (typeof window === 'undefined') return []
  try {
    const rawValue = window.localStorage.getItem(buildSessionPagesStorageKey(sessionId))
    const parsedValue = rawValue == null ? [] : JSON.parse(rawValue)
    if (!Array.isArray(parsedValue)) return []
    return parsedValue
      .filter((item): item is InteractionPanelSessionPage => (
        item != null &&
        typeof item === 'object' &&
        typeof item.id === 'string' &&
        typeof item.title === 'string'
      ))
      .map(normalizeSessionPage)
  } catch {
    return []
  }
}

export const writeInteractionPanelSessionPages = (
  sessionId: string,
  pages: InteractionPanelSessionPage[]
) => {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(buildSessionPagesStorageKey(sessionId), JSON.stringify(pages.map(normalizeSessionPage)))
  } catch {
    // Persisting panel session pages is best-effort only.
  }
}
