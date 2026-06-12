import { describe, expect, it } from 'vitest'

import {
  AVATAR_EYES,
  createAvatarSvg,
  createSeededAvatarDataUri,
  getAvatarPalette,
  resolveSeededAvatar
} from '../src/index.js'

const getGlyphBlockYValues = (svg: string, minX: number, maxX: number) => {
  return [
    ...new Set(
      [...svg.matchAll(/<rect x="([0-9.]+)" y="([0-9.]+)" width="6" height="6" fill="#[0-9a-fA-F]{6}"\/>/g)]
        .map(match => ({ x: Number(match[1]), y: Number(match[2]) }))
        .filter(rect => rect.x >= minX && rect.x <= maxX)
        .map(rect => rect.y)
    )
  ].sort((a, b) => a - b)
}

describe('@oneworks/avatar', () => {
  it('exports the symbolic eye glyphs used by the picker', () => {
    const eyeGlyphs = AVATAR_EYES.map(eye => eye.glyph)

    expect(eyeGlyphs).toContain('P')
    expect(eyeGlyphs).toContain('p')
    expect(eyeGlyphs).toContain('=')
    expect(eyeGlyphs).toContain('~')
    expect(eyeGlyphs).toContain('*')
  })

  it('lowers only lower-case p and q descenders', () => {
    const svg = createAvatarSvg({
      emoticon: 'pwp',
      palette: getAvatarPalette('black')
    })

    expect(getGlyphBlockYValues(svg, 5, 33)).toEqual([68, 75, 82, 89, 96])
    expect(getGlyphBlockYValues(svg, 47, 75)).toEqual([54, 61, 68, 75, 82])
    expect(getGlyphBlockYValues(svg, 89, 117)).toEqual([68, 75, 82, 89, 96])
  })

  it('resolves seeded avatars deterministically', () => {
    const first = resolveSeededAvatar({ seed: 'agent-room:codex' })
    const second = resolveSeededAvatar({ seed: 'agent-room:codex' })
    const dataUri = createSeededAvatarDataUri({ seed: 'agent-room:codex', size: 128 })

    expect(first).toEqual(second)
    expect(dataUri).toContain('data:image/svg+xml;charset=utf-8,')
  })
})
