import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const commonJsProfile = require('@oneworks/icon/brand-profile')
const esmProfile = await import('@oneworks/icon/brand-profile')

assert.equal(
  commonJsProfile.resolveOneWorksRelayBrandProfile('https://dev.vc.oneworks.cloud'),
  'vercel'
)
assert.equal(
  esmProfile.resolveOneWorksRelayBrandProfile('https://dev.cf.oneworks.cloud'),
  'cloudflare'
)

console.log('[icon] Node.js ESM and CommonJS brand profile exports verified')
