import { domainToASCII } from 'node:url'

export interface RelayEmailDomainPolicyInput {
  allowDomains: string[]
  blockDomains: string[]
  disposableBlocklist: boolean
}

export interface RelayEmailDomainDecision {
  allowed: boolean
  domain: string
}

const disposableDomains = new Set([
  '10minutemail.com',
  'dispostable.com',
  'emailondeck.com',
  'fakeinbox.com',
  'getnada.com',
  'guerrillamail.com',
  'mail.tm',
  'maildrop.cc',
  'mailinator.com',
  'mailnesia.com',
  'mintemail.com',
  'minuteinbox.com',
  'moakt.com',
  'sharklasers.com',
  'spamgourmet.com',
  'temp-mail.org',
  'tempr.email',
  'throwawaymail.com',
  'trashmail.com',
  'yopmail.com'
])

export const normalizeEmailDomain = (value: string) => {
  const domain = value.trim().toLowerCase().replace(/\.+$/, '')
  if (domain === '') return ''
  return domainToASCII(domain) || domain
}

export const normalizeEmailAddress = (value: unknown) => {
  if (typeof value !== 'string') return ''
  return value.trim().toLowerCase()
}

export const domainFromEmail = (email: string) => {
  const at = email.lastIndexOf('@')
  if (at <= 0 || at >= email.length - 1) return ''
  return normalizeEmailDomain(email.slice(at + 1))
}

export const looksLikeEmailAddress = (value: string) => {
  const at = value.indexOf('@')
  const dot = value.lastIndexOf('.')
  return at > 0 && dot > at + 1 && dot < value.length - 1 && !/\s/.test(value)
}

const normalizeDomainList = (domains: string[]) => (
  domains.map(normalizeEmailDomain).filter(domain => domain !== '')
)

const domainMatches = (domain: string, rule: string) => (
  domain === rule || domain.endsWith(`.${rule}`)
)

const containsDomain = (domains: string[], domain: string) => (
  domains.some(rule => domainMatches(domain, rule))
)

export const evaluateRelayEmailDomain = (
  email: string,
  policy: RelayEmailDomainPolicyInput
): RelayEmailDomainDecision => {
  const domain = domainFromEmail(email)
  const allowDomains = normalizeDomainList(policy.allowDomains)
  if (containsDomain(allowDomains, domain)) {
    return { allowed: true, domain }
  }

  const blockDomains = normalizeDomainList(policy.blockDomains)
  if (containsDomain(blockDomains, domain)) {
    return { allowed: false, domain }
  }

  if (policy.disposableBlocklist && containsDomain(Array.from(disposableDomains), domain)) {
    return { allowed: false, domain }
  }

  return { allowed: true, domain }
}
