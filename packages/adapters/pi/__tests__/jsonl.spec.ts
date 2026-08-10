import { describe, expect, it } from 'vitest'

import { JsonlDecoder } from '#~/runtime/protocol/jsonl.js'

describe('jsonl decoder', () => {
  it('preserves Unicode separators and handles chunked LF records', () => {
    const decoder = new JsonlDecoder()
    expect(decoder.push('{"text":"a\u2028b"}\n{"value":')).toEqual(['{"text":"a\u2028b"}'])
    expect(decoder.push('2}\r\n')).toEqual(['{"value":2}'])
    expect(decoder.finish()).toEqual([])
  })

  it('returns an unterminated final record without trimming JSON content', () => {
    const decoder = new JsonlDecoder()
    expect(decoder.push('  {"text":" keep "}')).toEqual([])
    expect(decoder.finish()).toEqual(['  {"text":" keep "}'])
  })
})
