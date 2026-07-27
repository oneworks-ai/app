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
})
