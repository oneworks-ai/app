import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'

import { describe, expect, it } from 'vitest'

import { evaluateRegistryMetadata, evaluateStableNpmSelection, verifyTarballBytes } from '../stable-npm-release.mjs'

const baseSelection = {
  allNames: ['@oneworks/core', 'oneworks', 'oneork', 'oneorks', 'onework'],
  bootstrapWithToken: false,
  dryRun: false,
  expectedRecoveryNames: [],
  expectedRef: 'refs/tags/pkg/oneworks/v0.1.0',
  githubRef: 'refs/tags/pkg/oneworks/v0.1.0',
  missingNames: [],
  publishAll: true,
  publishedNames: [],
  requestedNames: [],
  selectedNames: ['@oneworks/core', 'oneworks', 'oneork', 'oneorks', 'onework']
}

describe('stable npm release coordination', () => {
  it('requires the complete initial stable plan from the immutable package tag', () => {
    expect(evaluateStableNpmSelection(baseSelection)).toEqual([])
    expect(evaluateStableNpmSelection({
      ...baseSelection,
      publishAll: false,
      requestedNames: ['oneworks'],
      selectedNames: ['oneworks', 'oneork', 'oneorks', 'onework']
    })).toEqual(expect.arrayContaining([
      'Initial stable publication requires publish_all=true.',
      'Initial stable publication requires an empty packages input.',
      'Initial stable publication must contain the complete public identity plan.'
    ]))
    expect(evaluateStableNpmSelection({ ...baseSelection, githubRef: 'refs/heads/main' })).toEqual([
      'Stable publication must run from refs/tags/pkg/oneworks/v0.1.0; received refs/heads/main.'
    ])
  })

  it('allows only the exact missing closure for mixed-result token recovery', () => {
    const recovery = {
      ...baseSelection,
      bootstrapWithToken: true,
      expectedRecoveryNames: ['oneworks', 'oneork', 'oneorks', 'onework'],
      missingNames: ['oneork', 'oneorks', 'onework'],
      publishAll: false,
      publishedNames: ['@oneworks/core', 'oneworks'],
      requestedNames: ['oneork', 'oneorks', 'onework'],
      selectedNames: ['oneworks', 'oneork', 'oneorks', 'onework']
    }
    expect(evaluateStableNpmSelection(recovery)).toEqual([])
    expect(evaluateStableNpmSelection({
      ...recovery,
      selectedNames: ['@oneworks/core', ...recovery.selectedNames]
    })).toContain('Stable recovery selection must resolve to exactly the missing identity closure.')
  })

  it('requires recovery to follow a mixed registry result', () => {
    expect(evaluateStableNpmSelection({
      ...baseSelection,
      bootstrapWithToken: true,
      publishAll: false,
      requestedNames: ['oneworks'],
      selectedNames: baseSelection.allNames,
      expectedRecoveryNames: baseSelection.allNames,
      missingNames: baseSelection.allNames
    })).toContain('Stable token recovery requires a mixed-result publish with existing target versions.')
  })

  it('reconciles exact versions, latest tags, and distribution metadata', () => {
    const dist = { integrity: 'sha512-value', shasum: 'a'.repeat(40), tarball: 'https://example.test/a.tgz' }
    const evaluation = evaluateRegistryMetadata(
      [{ name: 'oneworks', version: '0.1.0' }],
      new Map([['oneworks', {
        'dist-tags': { latest: '0.1.0' },
        versions: { '0.1.0': { dist } }
      }]])
    )
    expect(evaluation).toEqual({
      mismatches: [],
      records: [{ name: 'oneworks', version: '0.1.0', dist }]
    })
  })

  it('rejects version and latest drift before tarball verification', () => {
    const evaluation = evaluateRegistryMetadata(
      [
        { name: '@oneworks/core', version: '0.1.0' },
        { name: 'oneworks', version: '0.1.0' }
      ],
      new Map([
        ['@oneworks/core', { 'dist-tags': { latest: '0.1.0' }, versions: {} }],
        ['oneworks', {
          'dist-tags': { latest: '0.1.0-rc.7' },
          versions: { '0.1.0': { dist: {} } }
        }]
      ])
    )
    expect(evaluation.mismatches).toEqual([
      '@oneworks/core@0.1.0 is missing',
      'oneworks latest does not point to 0.1.0',
      'oneworks@0.1.0 has incomplete distribution metadata'
    ])
  })

  it('recomputes npm integrity and shasum from downloaded bytes', () => {
    const bytes = Buffer.from('stable-package')
    const result = verifyTarballBytes(bytes, {
      integrity: `sha512-${createHash('sha512').update(bytes).digest('base64')}`,
      shasum: createHash('sha1').update(bytes).digest('hex')
    })
    expect(result.integrityMatches).toBe(true)
    expect(result.shasumMatches).toBe(true)
  })
})
