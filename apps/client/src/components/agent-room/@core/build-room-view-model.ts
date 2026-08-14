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
    ...(configured?.avatar != null && configured.avatar !== ''
      ? { avatar: configured.avatar }
      : {}),
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

const mergeAdjacentMemberJoinedMessages = (
  messages: AgentRoomComputedViewModel['messages']
): AgentRoomComputedViewModel['messages'] =>
  messages.reduce<AgentRoomComputedViewModel['messages']>((result, message) => {
    const joinedMembers = message.systemMessage?.kind === 'memberJoined'
      ? message.systemMessage.members
      : undefined
    const previous = result.at(-1)
    if (joinedMembers == null || previous?.systemMessage?.kind !== 'memberJoined') {
      result.push(message)
      return result
    }

    const membersByKey = new Map(
      [...previous.systemMessage.members, ...joinedMembers].map(member => [member.memberKey, member])
    )
    result[result.length - 1] = {
      ...previous,
      systemMessage: {
        kind: 'memberJoined',
        members: [...membersByKey.values()]
      }
    }
    return result
  }, [])

export function buildAgentRoomViewModel(room: AgentRoomViewModel): AgentRoomComputedViewModel {
  const membersByKey = new Map(room.members.map(member => [member.memberKey, member]))
  const runsByKey = new Map(
    room.members.flatMap(member => member.runs.map(run => [run.runKey, run] as const))
  )

  const messages = mergeAdjacentMemberJoinedMessages(room.messages.map(message => {
    const run = message.runKey == null ? undefined : runsByKey.get(message.runKey)
    const memberKey = message.memberKey ?? run?.memberKey
    const member = isLeaderMessage(message)
      ? getLeaderMember(message, membersByKey)
      : memberKey == null
      ? undefined
      : membersByKey.get(memberKey)

    const systemMessage = message.systemMessage?.kind === 'memberJoined'
      ? {
        kind: 'memberJoined' as const,
        members: message.systemMessage.members.map(snapshot => {
          const current = membersByKey.get(snapshot.memberKey)
          return current == null
            ? snapshot
            : {
              memberKey: current.memberKey,
              label: current.label,
              ...(current.avatar != null && current.avatar !== '' ? { avatar: current.avatar } : {}),
              ...(current.avatarLabel != null && current.avatarLabel !== ''
                ? { avatarLabel: current.avatarLabel }
                : {})
            }
        })
      }
      : message.systemMessage

    return {
      ...message,
      member,
      run,
      ...(systemMessage == null ? {} : { systemMessage })
    }
  }))

  return {
    ...room,
    messages,
    attentionCount: room.members.reduce((count, member) => count + member.pendingCount, 0),
    runningRunCount: countRuns(room.members, run => run.status === 'running'),
    completedRunCount: countRuns(room.members, run => run.status === 'completed'),
    failedRunCount: countRuns(room.members, run => run.status === 'failed')
  }
}
