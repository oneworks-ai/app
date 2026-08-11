export type ChannelApproverPrincipal = `user:${string}` | `account:${string}:${string}`

const trimNonEmpty = (value: unknown) => {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}

export const userApproverPrincipal = (userId: unknown): ChannelApproverPrincipal | undefined => {
  const normalized = trimNonEmpty(userId)
  return normalized == null || normalized.includes(':') ? undefined : `user:${normalized}`
}

export const accountApproverPrincipal = (
  issuerKey: unknown,
  accountId: unknown
): ChannelApproverPrincipal | undefined => {
  const issuer = trimNonEmpty(issuerKey)
  const account = trimNonEmpty(accountId)
  if (issuer == null || account == null || account.includes(':')) return undefined
  return `account:${issuer}:${account}`
}

export const parseChannelApproverPrincipal = (value: unknown) => {
  const principal = trimNonEmpty(value)
  if (principal == null) return undefined
  if (principal.startsWith('user:')) {
    const userId = principal.slice('user:'.length)
    return userApproverPrincipal(userId)
  }
  if (principal.startsWith('account:')) {
    const raw = principal.slice('account:'.length)
    const separator = raw.lastIndexOf(':')
    if (separator <= 0) return undefined
    return accountApproverPrincipal(raw.slice(0, separator), raw.slice(separator + 1))
  }
  return undefined
}

export const buildChannelApproverPrincipals = (input: {
  channelAdmins?: readonly string[]
  credentialSubjectUserId?: string | null
  issuerKey?: string | null
  requesterAccountId?: string | null
  requesterUserId?: string | null
}) => {
  const issuerKey = trimNonEmpty(input.issuerKey)
  const requesterUserId = trimNonEmpty(input.requesterUserId)
  const credentialSubjectUserId = trimNonEmpty(input.credentialSubjectUserId)
  const requesterOwnsCredential = credentialSubjectUserId == null || requesterUserId === credentialSubjectUserId
  const principals = [
    requesterOwnsCredential ? userApproverPrincipal(requesterUserId) : undefined,
    userApproverPrincipal(credentialSubjectUserId),
    requesterOwnsCredential ? accountApproverPrincipal(issuerKey, input.requesterAccountId) : undefined,
    ...(input.channelAdmins ?? []).map(admin => {
      const parsed = parseChannelApproverPrincipal(admin)
      if (parsed?.startsWith('user:')) return parsed
      if (parsed?.startsWith('account:')) {
        return parsed.startsWith(`account:${issuerKey}:`) ? parsed : undefined
      }
      return accountApproverPrincipal(issuerKey, admin)
    })
  ].filter((item): item is ChannelApproverPrincipal => item != null)
  return [...new Set(principals)]
}

export const isAllowedChannelApprover = (input: {
  accountId?: string | null
  allowedApprovers: readonly string[]
  issuerKey?: string | null
  userId?: string | null
}) => {
  const allowed = new Set(input.allowedApprovers.map(parseChannelApproverPrincipal).filter(Boolean))
  return [
    userApproverPrincipal(input.userId),
    accountApproverPrincipal(input.issuerKey, input.accountId)
  ].some(principal => principal != null && allowed.has(principal))
}
