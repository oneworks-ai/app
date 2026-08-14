import { describe, expect, it } from 'vitest'

import { NATIVE_HISTORY_IMPORT_MAX_FILE_SIZE_BYTES } from '@oneworks/types'

import {
  adapterAccountConfigCommonSchema,
  modelServiceConfigSchema,
  nativeHistoryImportConfigSchema
} from '../src/config-schema'

describe('adapter account config schema', () => {
  it('uses the shared credential revision domain and canonical form', () => {
    const uuid = '00000000-0000-0000-0000-00000000000A'
    expect(adapterAccountConfigCommonSchema.parse({
      credentialRevision: `0002:${uuid}`
    })).toEqual({
      credentialRevision: `2:${uuid.toLowerCase()}`
    })
    expect(
      adapterAccountConfigCommonSchema.safeParse({
        credentialRevision: `${Number.MAX_SAFE_INTEGER + 1}:${uuid}`
      }).success
    ).toBe(false)
  })
})

describe('model service protocol schema', () => {
  it('accepts the five declared wire protocols and rejects unknown values', () => {
    for (
      const apiProtocol of [
        'openai-responses',
        'openai-chat-completions',
        'anthropic-messages',
        'gemini-generate-content',
        'gemini-interactions'
      ]
    ) {
      expect(modelServiceConfigSchema.safeParse({ apiProtocol }).success).toBe(true)
    }
    expect(modelServiceConfigSchema.safeParse({ apiProtocol: 'openai-compatible' }).success).toBe(false)
  })
})

describe('native history import config schema', () => {
  it('accepts Cline as a registered native history adapter', () => {
    expect(nativeHistoryImportConfigSchema.parse({
      adapters: { cline: { autoImport: true, maxFileSizeBytes: 1024 } }
    })).toEqual({
      adapters: { cline: { autoImport: true, maxFileSizeBytes: 1024 } }
    })
  })
})

describe('native history import size schema', () => {
  it('accepts null and values through 50 MiB but rejects larger global and adapter limits', () => {
    for (const maxFileSizeBytes of [null, 1, NATIVE_HISTORY_IMPORT_MAX_FILE_SIZE_BYTES]) {
      expect(nativeHistoryImportConfigSchema.safeParse({ maxFileSizeBytes }).success).toBe(true)
      expect(
        nativeHistoryImportConfigSchema.safeParse({
          adapters: { cursor: { maxFileSizeBytes } }
        }).success
      ).toBe(true)
    }
    const aboveLimit = NATIVE_HISTORY_IMPORT_MAX_FILE_SIZE_BYTES + 1
    expect(nativeHistoryImportConfigSchema.safeParse({ maxFileSizeBytes: aboveLimit }).success).toBe(false)
    expect(
      nativeHistoryImportConfigSchema.safeParse({
        adapters: { 'qwen-code': { maxFileSizeBytes: aboveLimit } }
      }).success
    ).toBe(false)
  })
})
