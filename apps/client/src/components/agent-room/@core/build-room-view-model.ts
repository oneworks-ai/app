import type {
  AgentRoomComputedViewModel,
  AgentRoomMemberView,
  AgentRoomMessageSource,
  AgentRoomRunView,
  AgentRoomViewModel
} from '../@types/agent-room-view'

const countRuns = (
  members: AgentRoomMemberView[],
  predicate: (run: AgentRoomRunView) => boolean
) =>
  members.reduce(
    (count, member) => count + member.runs.filter(predicate).length,
    0
  )

const getConfiguredLeaderMember = (
  memberKey: string | undefined,
  membersByKey: Map<string, AgentRoomMemberView>
) => (
  (memberKey == null ? undefined : membersByKey.get(memberKey)) ??
    membersByKey.get('host') ??
    membersByKey.get('leader') ??
    [...membersByKey.values()].find(member => member.kind === 'host')
)

const getLeaderMember = (
  message: AgentRoomMessageSource,
  membersByKey: Map<string, AgentRoomMemberView>
): AgentRoomMemberView => {
  const configured = getConfiguredLeaderMember(message.memberKey, membersByKey)

  return {
    memberKey: message.memberKey ?? configured?.memberKey ?? 'host',
    kind: 'host',
    label: 'leader',
    ...(configured?.avatarLabel != null && configured.avatarLabel !== ''
      ? { avatarLabel: configured.avatarLabel }
      : {}),
    ...(configured?.subtitle != null && configured.subtitle !== '' ? { subtitle: configured.subtitle } : {}),
    status: configured?.status ?? 'active',
    pendingCount: configured?.pendingCount ?? 0,
    activeRunCount: configured?.activeRunCount ?? 0,
    latestSummary: configured?.latestSummary,
    runs: configured?.runs ?? []
  }
}

const isLeaderMessage = (message: AgentRoomMessageSource) =>
  message.kind === 'assignment' || message.memberKey === 'host' || message.memberKey?.startsWith('host:')

export function buildAgentRoomViewModel(room: AgentRoomViewModel): AgentRoomComputedViewModel {
  const membersByKey = new Map(room.members.map(member => [member.memberKey, member]))
  const runsByKey = new Map(
    room.members.flatMap(member => member.runs.map(run => [run.runKey, run] as const))
  )

  const messages = room.messages.map(message => {
    const run = message.runKey == null ? undefined : runsByKey.get(message.runKey)
    const memberKey = message.memberKey ?? run?.memberKey
    const member = isLeaderMessage(message)
      ? getLeaderMember(message, membersByKey)
      : memberKey == null
      ? undefined
      : membersByKey.get(memberKey)

    return {
      ...message,
      member,
      run
    }
  })

  return {
    ...room,
    messages,
    attentionCount: room.members.reduce((count, member) => count + member.pendingCount, 0),
    runningRunCount: countRuns(room.members, run => run.status === 'running'),
    completedRunCount: countRuns(room.members, run => run.status === 'completed'),
    failedRunCount: countRuns(room.members, run => run.status === 'failed')
  }
}
