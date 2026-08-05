import { randomBytes } from 'node:crypto'

const MAX_QUOTES = 256
const QUOTE_TTL_MS = 10 * 60 * 1000

interface IssuedQuote {
  claimGeneration: number
  digest: string
  expiresAt: number
  scope: string
  state: 'claimed' | 'issued'
}

export interface PluginMarketplaceUninstallQuoteClaim {
  claimGeneration: number
  digest: string
  scope: string
  token: string
}

const quotes = new Map<string, IssuedQuote>()
let nextClaimGeneration = 0

const removeExpiredQuotes = (now: number) => {
  for (const [token, quote] of quotes) {
    if (quote.expiresAt <= now) quotes.delete(token)
  }
  while (quotes.size >= MAX_QUOTES) {
    const oldest = quotes.keys().next().value as string | undefined
    if (oldest == null) break
    quotes.delete(oldest)
  }
}

export const issuePluginMarketplaceUninstallQuote = (params: {
  digest: string
  scope: string
}) => {
  const now = Date.now()
  removeExpiredQuotes(now)
  let token: string
  do token = randomBytes(32).toString('hex')
  while (quotes.has(token))
  quotes.set(token, {
    claimGeneration: 0,
    digest: params.digest,
    expiresAt: now + QUOTE_TTL_MS,
    scope: params.scope,
    state: 'issued'
  })
  return token
}

export const claimPluginMarketplaceUninstallQuote = (params: {
  scope: string
  token: string
}): PluginMarketplaceUninstallQuoteClaim | undefined => {
  const quote = quotes.get(params.token)
  if (
    quote == null || quote.expiresAt <= Date.now() || quote.scope !== params.scope ||
    quote.state !== 'issued'
  ) {
    if (quote?.expiresAt != null && quote.expiresAt <= Date.now()) quotes.delete(params.token)
    return undefined
  }
  nextClaimGeneration += 1
  quote.claimGeneration = nextClaimGeneration
  quote.state = 'claimed'
  return {
    claimGeneration: quote.claimGeneration,
    digest: quote.digest,
    scope: quote.scope,
    token: params.token
  }
}

export const releasePluginMarketplaceUninstallQuote = (
  claim: PluginMarketplaceUninstallQuoteClaim
) => {
  const quote = quotes.get(claim.token)
  if (
    quote == null || quote.state !== 'claimed' ||
    quote.claimGeneration !== claim.claimGeneration || quote.scope !== claim.scope
  ) return false
  quote.state = 'issued'
  return true
}

export const consumePluginMarketplaceUninstallQuote = (
  claim: PluginMarketplaceUninstallQuoteClaim
) => {
  const quote = quotes.get(claim.token)
  if (
    quote == null || quote.state !== 'claimed' ||
    quote.claimGeneration !== claim.claimGeneration || quote.scope !== claim.scope
  ) return false
  quotes.delete(claim.token)
  return true
}

export const resetPluginMarketplaceUninstallQuotesForTesting = () => {
  quotes.clear()
  nextClaimGeneration = 0
}
