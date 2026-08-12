import { createRequire } from 'node:module'

import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const { resolveNotarizationArtifactPaths } = require(
  '../scripts/notarize-artifacts.cjs'
) as typeof import('../scripts/notarize-artifacts.cjs')

describe('desktop installer notarization', () => {
  it('selects DMG and PKG artifacts without submitting update metadata or ZIP files', () => {
    expect(resolveNotarizationArtifactPaths({
      artifactPaths: [
        '/release/oneworks-arm64.dmg',
        '/release/oneworks-arm64.pkg',
        '/release/oneworks-arm64.zip',
        '/release/beta-mac.yml'
      ]
    })).toEqual([
      '/release/oneworks-arm64.dmg',
      '/release/oneworks-arm64.pkg'
    ])
  })

  it('keeps deferred notarization out of electron-builder', async () => {
    const previousSign = process.env.ONEWORKS_DESKTOP_SIGN
    const previousDeferred = process.env.ONEWORKS_DESKTOP_DEFER_NOTARIZATION
    process.env.ONEWORKS_DESKTOP_SIGN = 'true'
    process.env.ONEWORKS_DESKTOP_DEFER_NOTARIZATION = 'true'
    try {
      const result = await require('../scripts/notarize-artifacts.cjs').default({
        artifactPaths: ['/release/oneworks-arm64.dmg']
      })
      expect(result).toEqual([])
    } finally {
      if (previousSign == null) delete process.env.ONEWORKS_DESKTOP_SIGN
      else process.env.ONEWORKS_DESKTOP_SIGN = previousSign
      if (previousDeferred == null) delete process.env.ONEWORKS_DESKTOP_DEFER_NOTARIZATION
      else process.env.ONEWORKS_DESKTOP_DEFER_NOTARIZATION = previousDeferred
    }
  })
})
