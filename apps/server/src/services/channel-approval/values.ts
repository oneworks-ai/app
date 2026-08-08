import type { ChannelApprovalRequestInput } from './types.js'

export const trimNonEmpty = (value: unknown) => {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}

const uniqueStrings = (values: readonly (string | undefined)[]) => {
  const seen = new Set<string>()
  for (const value of values) {
    const normalized = trimNonEmpty(value)
    if (normalized != null) {
      seen.add(normalized)
    }
  }
  return [...seen]
}

export const hasAnyAdminRef = (input: ChannelApprovalRequestInput) => {
  const admins = new Set((input.channelAdmins ?? []).map(item => item.trim()).filter(Boolean))
  if (admins.size === 0) return false
  return uniqueStrings([input.actorUserId, input.actorAccountId, input.senderId]).some(ref => admins.has(ref))
}
