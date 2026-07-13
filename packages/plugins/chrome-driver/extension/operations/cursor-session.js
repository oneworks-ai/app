export function normalizeStoredCursorSession(value) {
  if (typeof value === 'string' && value !== '') {
    return { connectionId: undefined, cursorSessionId: value }
  }
  if (value == null || typeof value !== 'object') return undefined
  if (typeof value.cursor_session_id !== 'string' || value.cursor_session_id === '') return undefined
  return {
    connectionId: typeof value.connection_id === 'string' ? value.connection_id : undefined,
    cursorSessionId: value.cursor_session_id
  }
}

export function selectCursorSession({ connectionId, createId, previousConnection, reused, storedSession }) {
  if (
    reused && previousConnection?.connection_id === connectionId &&
    typeof previousConnection.cursor_session_id === 'string' && previousConnection.cursor_session_id !== ''
  ) {
    return previousConnection.cursor_session_id
  }
  if (
    reused && previousConnection == null && storedSession?.cursorSessionId != null &&
    (storedSession.connectionId == null || storedSession.connectionId === connectionId)
  ) {
    return storedSession.cursorSessionId
  }
  return createId()
}
