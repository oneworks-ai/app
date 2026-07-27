import { describe, expect, it } from 'vitest'

import { createMobiusCore, createSeededRandom, normalizeSeed } from '../src/core.js'
import { ONEWORKS_ICON_THEMES, normalizeIconTheme } from '../src/presets.js'
import { createMobiusSvg } from '../src/svg.js'

describe('@oneworks/icon core', () => {
  it('normalizes externally supplied seeds', () => {
    expect(normalizeSeed(' one works! 2026 ')).toBe('oneworks2026')
    expect(normalizeSeed('')).toBeNull()
  })

  it('keeps seeded random output deterministic', () => {
    const first = createSeededRandom('brand-v1')
    const second = createSeededRandom('brand-v1')

    expect(Array.from({ length: 5 }, () => first())).toEqual(Array.from({ length: 5 }, () => second()))
  })

  it('builds stable static meshes for the default Mobius surface', () => {
    const core = createMobiusCore('brand-v1')

    expect(core.staticMesh).toHaveLength(1416)
    expect(core.staticMesh[0]?.points).toHaveLength(4)
  })
})

describe('@oneworks/icon svg', () => {
  it('renders a deterministic SVG document', () => {
    const svg = createMobiusSvg({
      mode: 'dark',
      seed: 'brand-v1',
      size: 128,
      theme: 'industrial'
    })

    expect(svg).toContain('<svg xmlns="http://www.w3.org/2000/svg"')
    expect(svg).toContain('oneworks-industrial-dark-brand-v1-128')
    expect(svg).toContain('shape-rendering="geometricPrecision"')
  })

  it('renders the linear theme as a flat single-color ribbon', () => {
    const svg = createMobiusSvg({
      backgroundStyle: 'transparent',
      mode: 'dark',
      seed: 'brand-v1',
      size: 128,
      theme: 'linear'
    })

    expect(ONEWORKS_ICON_THEMES).toContain('linear')
    expect(normalizeIconTheme('linear')).toBe('linear')
    expect(svg).toContain('oneworks-linear-dark-brand-v1-128')
    expect(svg).toContain('data-oneworks-surface="linear"')
    expect(svg).toContain('fill="rgb(226,235,242)"')
    expect(svg).toContain('fill="rgba(8,10,13,0.9)" stroke="none"')
    expect(svg).toContain('data-oneworks-ribbon-border="true"')
    const borderPaths = svg.match(
      /<path d="M[^"]+ Z" fill="rgba\(8,10,13,0\.9\)" stroke="none" data-oneworks-ribbon-border="true"\/>/g
    )
    expect(borderPaths).toHaveLength(236)
  })

  it('renders solid and transparent background variants', () => {
    const solidSvg = createMobiusSvg({
      backgroundStyle: 'solid',
      mode: 'dark',
      seed: 'brand-v1',
      size: 128,
      theme: 'matrix'
    })
    const transparentSvg = createMobiusSvg({
      backgroundStyle: 'transparent',
      mode: 'dark',
      seed: 'brand-v1',
      size: 128,
      theme: 'matrix'
    })

    expect(solidSvg).toContain('fill="#001B0D"')
    expect(solidSvg).not.toContain('matrix-glow')
    expect(transparentSvg).not.toContain('fill="#001B0D"')
  })
})
