import type { AgentRoomMessageView, AgentRoomViewModel } from '../@types/agent-room-view'
import { buildAgentRoomViewModel } from './build-room-view-model'

const isPendingApprovalMessage = (message: AgentRoomMessageView) => {
  if (message.role !== 'agent') {
    return false
  }

  return message.kind === 'attention' ||
    message.run?.status === 'waiting' ||
    message.member?.status === 'waiting'
}

export function getAgentRoomApprovalMessages(room: AgentRoomViewModel): AgentRoomMessageView[] {
  const computedRoom = buildAgentRoomViewModel(room)
  const seenKeys = new Set<string>()
  const approvals: AgentRoomMessageView[] = []

  for (let index = computedRoom.messages.length - 1; index >= 0; index -= 1) {
    const message = computedRoom.messages[index]!
    if (!isPendingApprovalMessage(message)) {
      continue
    }

    const key = message.run?.runKey ?? message.id
    if (seenKeys.has(key)) {
      continue
    }

    seenKeys.add(key)
    approvals.push(message)
  }

  return approvals.reverse()
}
