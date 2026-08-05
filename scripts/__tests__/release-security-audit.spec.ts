import { describe, expect, it } from 'vitest'

import { evaluateProductionAudit } from '../release-security-audit.mjs'

const advisory = (overrides: Record<string, unknown> = {}) => ({
  findings: [{ paths: ['apps__server>vite'] }],
  module_name: 'vite',
  severity: 'high',
  title: 'Unexpected high severity advisory',
  url: 'https://github.com/advisories/GHSA-test-test-test',
  ...overrides
})

describe('release production security audit', () => {
  it('rejects unexpected high and critical advisories', () => {
    const result = evaluateProductionAudit({
      advisories: {
        high: advisory(),
        critical: advisory({ severity: 'critical' })
      }
    })

    expect(result.allowed).toEqual([])
    expect(result.unexpected).toHaveLength(2)
  })

  it('allows only the scoped Relay Admin RSC advisory', () => {
    const result = evaluateProductionAudit({
      advisories: {
        rsc: advisory({
          findings: [{ paths: ['apps__relay-admin>react-router-dom>react-router'] }],
          module_name: 'react-router',
          url: 'https://github.com/advisories/GHSA-qwww-vcr4-c8h2'
        })
      }
    })

    expect(result.unexpected).toEqual([])
    expect(result.allowed).toEqual([
      expect.objectContaining({ id: 'GHSA-QWWW-VCR4-C8H2' })
    ])
  })

  it('rejects the waiver when the advisory reaches another runtime path', () => {
    const result = evaluateProductionAudit({
      advisories: {
        rsc: advisory({
          findings: [{ paths: ['apps__server>react-router'] }],
          module_name: 'react-router',
          url: 'https://github.com/advisories/GHSA-qwww-vcr4-c8h2'
        })
      }
    })

    expect(result.allowed).toEqual([])
    expect(result.unexpected).toHaveLength(1)
  })

  it('rejects lookalike dependency paths outside the exact waiver', () => {
    const result = evaluateProductionAudit({
      advisories: {
        rsc: advisory({
          findings: [{ paths: ['apps__relay-admin>react-router-dom>react-router-extra'] }],
          module_name: 'react-router',
          url: 'https://github.com/advisories/GHSA-qwww-vcr4-c8h2'
        })
      }
    })

    expect(result.allowed).toEqual([])
    expect(result.unexpected).toHaveLength(1)
  })
})
