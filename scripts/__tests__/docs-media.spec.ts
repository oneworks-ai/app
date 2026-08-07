import { Buffer } from 'node:buffer'

import { describe, expect, it } from 'vitest'

import { assertFastStartMp4 } from '../docs-media'

const atom = (name: string) =>
  Buffer.concat([
    Buffer.from([0, 0, 0, 8]),
    Buffer.from(name)
  ])

describe('documentation media verification', () => {
  it('accepts fast-start MP4 atom ordering', () => {
    expect(() => {
      assertFastStartMp4(
        Buffer.concat([atom('ftyp'), atom('moov'), atom('mdat')]),
        'demo.mp4'
      )
    }).not.toThrow()
  })

  it('rejects MP4 files whose metadata follows the video payload', () => {
    expect(() => {
      assertFastStartMp4(
        Buffer.concat([atom('ftyp'), atom('mdat'), atom('moov')]),
        'demo.mp4'
      )
    }).toThrow('moov atom must precede mdat')
  })
})
