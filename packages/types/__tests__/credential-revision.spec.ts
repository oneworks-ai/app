import { describe, expect, it } from 'vitest'

import {
  compareCredentialRevisions,
  isCredentialRevision,
  normalizeCredentialRevision,
  parseCredentialRevision
} from '../src/credential-revision'

const lowerUuid = '00000000-0000-0000-0000-00000000000a'
const upperUuid = '00000000-0000-0000-0000-00000000000A'

describe('credential revision contract', () => {
  it('normalizes safe counters, leading zeroes, and UUID casing', () => {
    expect(parseCredentialRevision(`0002:${upperUuid}`)).toEqual({
      counter: 2,
      id: lowerUuid
    })
    expect(normalizeCredentialRevision(`0002:${upperUuid}`)).toBe(`2:${lowerUuid}`)
    expect(normalizeCredentialRevision(`${Number.MAX_SAFE_INTEGER}:${upperUuid}`)).toBe(
      `${Number.MAX_SAFE_INTEGER}:${lowerUuid}`
    )
  })

  it('rejects counters outside the non-negative safe integer domain', () => {
    expect(isCredentialRevision(`0:${lowerUuid}`)).toBe(true)
    expect(isCredentialRevision(`-1:${lowerUuid}`)).toBe(false)
    expect(isCredentialRevision(`${Number.MAX_SAFE_INTEGER + 1}:${lowerUuid}`)).toBe(false)
    expect(isCredentialRevision(`1:not-a-uuid`)).toBe(false)
  })

  it('compares normalized revisions without unsafe integer subtraction', () => {
    expect(compareCredentialRevisions(`0002:${upperUuid}`, `1:${lowerUuid}`)).toBe(1)
    expect(compareCredentialRevisions(`2:${lowerUuid}`, `0002:${upperUuid}`)).toBe(0)
    expect(compareCredentialRevisions(undefined, `0:${lowerUuid}`)).toBe(-1)
  })
})
