/* eslint-disable max-lines */

import type { AgentRoomMemberKind, AgentRoomMessageWriteRequest, AgentRoomUserMessageTarget } from '@oneworks/core'

export interface AgentRoomTargetRun {
  runKey: string
  memberKey: string
  title: string
}

export interface AgentRoomTargetMember {
  memberKey: string
  label: string
  kind?: AgentRoomMemberKind
  runs: AgentRoomTargetRun[]
}

export interface AgentRoomMentionCompletion {
  value: string
  target: AgentRoomUserMessageTarget
  kind: 'member' | 'run'
}

export type AgentRoomTargetRoute = 'host' | 'member' | 'run'

export interface AgentRoomSenderSubmit extends AgentRoomMessageWriteRequest {
  route: AgentRoomTargetRoute
}

export interface AgentRoomConversationTargetPreview {
  status: AgentRoomTargetRoute | 'missing' | 'ambiguous'
  targetLabel: string
}

export type AgentRoomTargetResolution =
  | {
    status: 'empty'
  }
  | {
    status: 'missing'
    mention: string
  }
  | {
    status: 'ambiguous'
    mention: string
    suggestions: AgentRoomMentionCompletion[]
  }
  | {
    status: 'empty-targeted-message'
    mention: string
    target: AgentRoomUserMessageTarget
    route: Exclude<AgentRoomTargetRoute, 'host'>
    previewLabel: string
  }
  | {
    status: 'resolved'
    content: string
    target?: AgentRoomUserMessageTarget
    route: AgentRoomTargetRoute
    mention?: string
    previewLabel: string
  }

const tokenMentionPattern = /(^|\s)@(\S*)$/

const normalizeAlias = (value: string) => value.trim().toLowerCase()

const stripKeyPrefix = (value: string) => {
  const index = value.lastIndexOf(':')
  return index >= 0 ? value.slice(index + 1) : value
}

const stripMentionPrefix = (value: string) => value.replace(/^@+/, '')

const getMentionSegment = (...values: string[]) => {
  for (const value of values) {
    const segment = stripMentionPrefix(stripKeyPrefix(value)).trim()
    if (segment !== '') {
      return segment
    }
  }

  return ''
}

const unique = (values: string[]) => Array.from(new Set(values.map(normalizeAlias).filter(Boolean)))

const getMemberAliases = (member: AgentRoomTargetMember) =>
  unique([
    member.label,
    stripMentionPrefix(member.label),
    getMentionSegment(member.label),
    member.memberKey,
    stripKeyPrefix(member.memberKey),
    getMentionSegment(member.memberKey)
  ])

const getRunAliases = (run: AgentRoomTargetRun) =>
  unique([
    run.title,
    stripMentionPrefix(run.title),
    getMentionSegment(run.title),
    run.runKey,
    stripKeyPrefix(run.runKey),
    getMentionSegment(run.runKey)
  ])

export const getAgentRoomMemberMention = (member: AgentRoomTargetMember) => (
  `@${getMentionSegment(member.label, member.memberKey)}`
)

const getRunMention = (member: AgentRoomTargetMember, run: AgentRoomTargetRun) => (
  `${getAgentRoomMemberMention(member)}/${getMentionSegment(run.title, run.runKey)}`
)

const getMemberDisplayLabel = (member: AgentRoomTargetMember) => (
  getMentionSegment(member.label, member.memberKey)
)

const getRunDisplayLabel = (member: AgentRoomTargetMember, run: AgentRoomTargetRun) => (
  `${getMemberDisplayLabel(member)}/${getMentionSegment(run.title, run.runKey)}`
)

const isHostMember = (member: AgentRoomTargetMember) => {
  const normalizedKey = normalizeAlias(member.memberKey)
  return member.kind === 'host' ||
    normalizedKey === 'host' ||
    normalizedKey.startsWith('host:') ||
    getMemberAliases(member).some(alias => alias === 'host' || alias === 'leader')
}

const getHostMember = (members: AgentRoomTargetMember[]) => members.find(isHostMember)

const findMembers = (members: AgentRoomTargetMember[], alias: string) => {
  const normalizedAlias = normalizeAlias(alias)
  return members.filter(member => getMemberAliases(member).includes(normalizedAlias))
}

const findRuns = (member: AgentRoomTargetMember, alias: string) => {
  const normalizedAlias = normalizeAlias(alias)
  return member.runs.filter(run => getRunAliases(run).includes(normalizedAlias))
}

const findMemberByKey = (members: AgentRoomTargetMember[], memberKey?: string) => (
  memberKey == null ? undefined : members.find(member => member.memberKey === memberKey)
)

const findRunByKey = (member: AgentRoomTargetMember | undefined, runKey?: string) => (
  member == null || runKey == null ? undefined : member.runs.find(run => run.runKey === runKey)
)

const getHostTargetPreview = (members: AgentRoomTargetMember[]): AgentRoomConversationTargetPreview => {
  const host = getHostMember(members)
  return {
    status: 'host',
    targetLabel: host == null ? 'leader' : getMemberDisplayLabel(host)
  }
}

const parseLeadingMention = (value: string) => {
  if (!value.startsWith('@')) {
    return undefined
  }

  const firstWhitespaceIndex = value.search(/\s/)
  const token = firstWhitespaceIndex >= 0 ? value.slice(0, firstWhitespaceIndex) : value
  return {
    alias: token.slice(1),
    mention: token,
    contentStart: token.length
  }
}

const getRunTargetCandidates = (
  members: AgentRoomTargetMember[],
  alias: string
) => {
  const candidates: Array<{
    runAlias: string
    members: AgentRoomTargetMember[]
  }> = []

  for (let index = alias.indexOf('/'); index >= 0; index = alias.indexOf('/', index + 1)) {
    const memberAlias = alias.slice(0, index)
    const runAlias = alias.slice(index + 1)
    if (memberAlias.trim() === '' || runAlias.trim() === '') continue

    const matchingMembers = findMembers(members, memberAlias)
    if (matchingMembers.length > 0) {
      candidates.push({ runAlias, members: matchingMembers })
    }
  }

  return candidates
}

const toMemberCompletion = (member: AgentRoomTargetMember): AgentRoomMentionCompletion => ({
  value: getAgentRoomMemberMention(member),
  target: { memberKey: member.memberKey },
  kind: 'member'
})

const toRunCompletion = (
  member: AgentRoomTargetMember,
  run: AgentRoomTargetRun
): AgentRoomMentionCompletion => ({
  value: getRunMention(member, run),
  target: { memberKey: member.memberKey, runKey: run.runKey },
  kind: 'run'
})

const toMemberSuggestions = (members: AgentRoomTargetMember[]) => members.map(toMemberCompletion)

const toRunSuggestions = (member: AgentRoomTargetMember, runs: AgentRoomTargetRun[]) => (
  runs.map(run => toRunCompletion(member, run))
)

export function getAgentRoomMentionCompletions(
  members: AgentRoomTargetMember[],
  query = ''
): AgentRoomMentionCompletion[] {
  const normalizedQuery = normalizeAlias(query.replace(/^@/, ''))
  const completions = members.flatMap(member => [
    toMemberCompletion(member),
    ...member.runs.map(run => toRunCompletion(member, run))
  ])

  if (normalizedQuery === '') {
    return completions
  }

  return completions.filter(completion => normalizeAlias(completion.value.slice(1)).startsWith(normalizedQuery))
}

export function getAgentRoomMentionQuery(value: string, selectionStart = value.length) {
  const prefix = value.slice(0, selectionStart)
  const match = tokenMentionPattern.exec(prefix)
  return match == null ? undefined : match[2]
}

export function applyAgentRoomMentionCompletion(
  value: string,
  mention: string,
  selectionStart = value.length
) {
  const prefix = value.slice(0, selectionStart)
  const suffix = value.slice(selectionStart)
  const match = tokenMentionPattern.exec(prefix)
  if (match == null) {
    return `${mention} ${value.trimStart()}`
  }

  return `${prefix.slice(0, match.index)}${match[1]}${mention} ${suffix.trimStart()}`
}

export function resolveRoomTarget(value: string, members: AgentRoomTargetMember[]): AgentRoomTargetResolution {
  const trimmedStart = value.trimStart()
  if (trimmedStart.trim() === '') {
    return { status: 'empty' }
  }

  const leadingMention = parseLeadingMention(trimmedStart)
  if (leadingMention == null) {
    const host = getHostMember(members)
    const content = trimmedStart.trim()
    return {
      status: 'resolved',
      content,
      ...(host != null ? { target: { memberKey: host.memberKey } } : {}),
      route: 'host',
      previewLabel: host == null ? 'Host agent' : getAgentRoomMemberMention(host)
    }
  }

  const { alias, mention } = leadingMention
  const matchingMembers = findMembers(members, alias)
  if (matchingMembers.length === 0) {
    const runCandidates = getRunTargetCandidates(members, alias)
    if (runCandidates.length === 0) {
      return { status: 'missing', mention }
    }

    const matchingRuns = runCandidates.flatMap(candidate => (
      candidate.members.flatMap(member => (
        findRuns(member, candidate.runAlias).map(run => ({ member, run }))
      ))
    ))
    if (matchingRuns.length === 0) {
      return { status: 'missing', mention }
    }
    if (matchingRuns.length > 1) {
      return {
        status: 'ambiguous',
        mention,
        suggestions: matchingRuns.map(({ member, run }) => toRunCompletion(member, run))
      }
    }

    const { member, run } = matchingRuns[0]!
    const target = { memberKey: member.memberKey, runKey: run.runKey }
    const content = trimmedStart.slice(leadingMention.contentStart).trim()
    const previewLabel = getRunMention(member, run)
    if (content === '') {
      return {
        status: 'empty-targeted-message',
        mention,
        target,
        route: 'run',
        previewLabel
      }
    }

    return {
      status: 'resolved',
      content,
      target,
      route: 'run',
      mention,
      previewLabel
    }
  }
  if (matchingMembers.length > 1) {
    return {
      status: 'ambiguous',
      mention,
      suggestions: toMemberSuggestions(matchingMembers)
    }
  }

  const member = matchingMembers[0]!
  const target = { memberKey: member.memberKey }
  const content = trimmedStart.slice(leadingMention.contentStart).trim()
  const previewLabel = `${getAgentRoomMemberMention(member)} mailbox`
  if (content === '') {
    return {
      status: 'empty-targeted-message',
      mention,
      target,
      route: 'member',
      previewLabel
    }
  }

  return {
    status: 'resolved',
    content,
    target,
    route: 'member',
    mention,
    previewLabel
  }
}

export function getAgentRoomConversationTargetPreview(
  value: string,
  members: AgentRoomTargetMember[]
): AgentRoomConversationTargetPreview {
  const trimmedStart = value.trimStart()
  if (trimmedStart === '' || !trimmedStart.startsWith('@')) {
    return getHostTargetPreview(members)
  }

  const resolution = resolveRoomTarget(value, members)

  if (resolution.status === 'missing' || resolution.status === 'ambiguous') {
    return {
      status: resolution.status,
      targetLabel: resolution.mention
    }
  }

  if (resolution.status === 'empty') {
    return getHostTargetPreview(members)
  }

  const member = findMemberByKey(members, resolution.target?.memberKey)
  const run = findRunByKey(member, resolution.target?.runKey)

  if (resolution.route === 'run') {
    return {
      status: 'run',
      targetLabel: member == null || run == null ? resolution.previewLabel : getRunDisplayLabel(member, run)
    }
  }

  if (resolution.route === 'member') {
    return {
      status: 'member',
      targetLabel: member == null ? resolution.previewLabel : getMemberDisplayLabel(member)
    }
  }

  return getHostTargetPreview(members)
}

export function createAgentRoomSenderSubmit(
  resolution: Extract<AgentRoomTargetResolution, { status: 'resolved' }>
): AgentRoomSenderSubmit {
  return {
    content: resolution.content,
    ...(resolution.target != null ? { target: resolution.target } : {}),
    route: resolution.route
  }
}
