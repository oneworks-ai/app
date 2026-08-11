type AgentRoomShareListener = (roomId: string) => void

const listeners = new Set<AgentRoomShareListener>()

export const publishAgentRoomShareChanged = (roomId: string) => {
  for (const listener of listeners) listener(roomId)
}

export const subscribeAgentRoomShareChanged = (listener: AgentRoomShareListener) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
