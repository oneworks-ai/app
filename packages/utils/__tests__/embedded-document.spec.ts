import { describe, expect, it } from 'vitest'

import { projectEmbeddedDocument } from '#~/embedded-document.js'

describe('embedded document projection', () => {
  it('uses a content-addressed path without exposing a source path or payload', () => {
    const document = projectEmbeddedDocument({
      data: 'private document body',
      encoding: 'utf8',
      mimeType: 'text/plain',
      name: '../../private\u0000notes.txt'
    })
    expect(document).toEqual(expect.objectContaining({
      type: 'file',
      name: '..-..-private-notes.txt',
      data: 'private document body',
      encoding: 'utf8',
      mimeType: 'text/plain',
      size: 21
    }))
    expect(document?.path).toMatch(/^factory-document:\/\/sha256\/[a-f0-9]{64}$/u)
    expect(document?.path).not.toContain('private document body')
  })

  it('rejects malformed base64 and payloads one byte over the configured limit', () => {
    expect(projectEmbeddedDocument({
      data: 'not-base64!',
      encoding: 'base64',
      mimeType: 'application/pdf'
    })).toBeUndefined()
    expect(projectEmbeddedDocument({
      data: '12345',
      encoding: 'utf8',
      maxBytes: 4,
      mimeType: 'text/plain'
    })).toBeUndefined()
  })
})
