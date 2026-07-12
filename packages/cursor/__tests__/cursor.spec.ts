import { describe, expect, it } from 'vitest'

import { createOneWorksCursorSvg, resolveCursorBorderColor } from '../index.cjs'

describe('@oneworks/cursor', () => {
  it('renders the reusable rounded pointer with caller-selected colors', () => {
    const svg = createOneWorksCursorSvg({ color: '#625bf6' })
    expect(svg).toContain('fill="#625BF6"')
    expect(svg).toContain('stroke="#FFFFFF"')
    expect(svg).toContain('stroke-linejoin="round"')
    expect(svg).toContain('rotate(-90 32 32)')
  })

  it('uses a dark border for light colors and accepts an explicit border', () => {
    expect(resolveCursorBorderColor('#fff')).toBe('#596273')
    expect(createOneWorksCursorSvg({ borderColor: '#123', color: '#fff', size: 128 }))
      .toContain('stroke="#112233"')
  })

  it('rejects invalid input without owning caller color-selection policy', () => {
    expect(() => createOneWorksCursorSvg({ color: 'purple' })).toThrow('CSS hex color')
    expect(() => createOneWorksCursorSvg({ color: '#625BF6', size: 0 })).toThrow('positive')
  })
})
