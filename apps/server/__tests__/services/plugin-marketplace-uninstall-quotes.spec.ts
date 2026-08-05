import { beforeEach, describe, expect, it } from 'vitest'

import {
  claimPluginMarketplaceUninstallQuote,
  consumePluginMarketplaceUninstallQuote,
  issuePluginMarketplaceUninstallQuote,
  releasePluginMarketplaceUninstallQuote,
  resetPluginMarketplaceUninstallQuotesForTesting
} from '#~/services/plugins/marketplace-uninstall-quotes.js'

describe('plugin marketplace uninstall quote CAS', () => {
  beforeEach(() => resetPluginMarketplaceUninstallQuotesForTesting())

  it('rejects missing, wrong-scope, concurrent, and successful replay claims', () => {
    const token = issuePluginMarketplaceUninstallQuote({ digest: 'snapshot', scope: 'airtable' })
    expect(claimPluginMarketplaceUninstallQuote({ scope: 'other', token })).toBeUndefined()
    const claim = claimPluginMarketplaceUninstallQuote({ scope: 'airtable', token })
    expect(claim).toBeDefined()
    expect(claimPluginMarketplaceUninstallQuote({ scope: 'airtable', token })).toBeUndefined()
    expect(consumePluginMarketplaceUninstallQuote(claim!)).toBe(true)
    expect(claimPluginMarketplaceUninstallQuote({ scope: 'airtable', token })).toBeUndefined()
  })

  it('prevents an old attempt from releasing a newer claim generation', () => {
    const token = issuePluginMarketplaceUninstallQuote({ digest: 'snapshot', scope: 'airtable' })
    const first = claimPluginMarketplaceUninstallQuote({ scope: 'airtable', token })!
    expect(releasePluginMarketplaceUninstallQuote(first)).toBe(true)
    const second = claimPluginMarketplaceUninstallQuote({ scope: 'airtable', token })!
    expect(releasePluginMarketplaceUninstallQuote(first)).toBe(false)
    expect(claimPluginMarketplaceUninstallQuote({ scope: 'airtable', token })).toBeUndefined()
    expect(consumePluginMarketplaceUninstallQuote(second)).toBe(true)
  })
})
