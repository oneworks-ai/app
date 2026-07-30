import { describe, expect, it } from 'vitest'

import { resolveViteBuildMetadata } from '../vite.config'

describe('Vite build metadata', () => {
  it('falls through invalid explicit metadata to CI and package candidates', () => {
    expect(resolveViteBuildMetadata({
      buildTime: ['2026-02-30T00:00:00Z', '2026-07-30T00:09:10Z'],
      commit: ['not-a-commit', 'abcdef0123456789abcdef0123456789abcdef01'],
      version: ['01.2.3', '2.3.4']
    })).toEqual({
      buildTime: '2026-07-30T00:09:10.000Z',
      commit: 'abcdef0123456789abcdef0123456789abcdef01',
      version: '2.3.4'
    })
  })

  it('accepts a whitespace-padded 0.0.0 candidate but rejects non-canonical versions', () => {
    expect(resolveViteBuildMetadata({
      buildTime: [],
      commit: [],
      version: [' 0.0.0 ', '2.3.4']
    }).version).toBe('0.0.0')
    expect(resolveViteBuildMetadata({
      buildTime: [],
      commit: [],
      version: [' 00.0.0 ', '2.3.4']
    }).version).toBe('2.3.4')
  })

  it('skips Proxy candidates before any reflective normalization', () => {
    let trapCount = 0
    const candidate = new Proxy({}, {
      get: () => {
        trapCount += 1
        return undefined
      },
      getOwnPropertyDescriptor: () => {
        trapCount += 1
        return undefined
      },
      getPrototypeOf: () => {
        trapCount += 1
        return null
      }
    })

    expect(resolveViteBuildMetadata({
      buildTime: [candidate, '2026-07-30T00:09:10Z'],
      commit: [candidate, 'abcdef0123456789abcdef0123456789abcdef01'],
      version: [candidate, '2.3.4']
    })).toMatchObject({ version: '2.3.4' })
    expect(trapCount).toBe(0)
  })
})
