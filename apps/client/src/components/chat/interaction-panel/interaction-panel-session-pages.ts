export interface InteractionPanelSessionPage {
  focusRequestId?: string
  id: string
  sessionId?: string
  title: string
}

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

export const normalizeSessionPage = (page: InteractionPanelSessionPage): InteractionPanelSessionPage => {
  const sessionId = page.sessionId?.trim()
  return {
    id: page.id,
    title: page.title.trim() || sessionId || page.id,
    ...(sessionId == null || sessionId === '' ? {} : { sessionId })
  }
}
