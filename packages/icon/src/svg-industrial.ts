import { createSeededRandom } from './core.js'
import type { SvgSection } from './svg-types.js'
import { formatNumber, tileRect } from './svg-utils.js'
import type { ColorRgb } from './types.js'

export const createIndustrialBackground = (
  id: string,
  offset: number,
  size: number,
  radius: number,
  mode: string,
  seed: string
): SvgSection => {
  const cells = createCells(offset, size, mode, seed)
  const baseStops = mode === 'dark'
    ? [
      '<stop offset="0%" stop-color="#160b07"/>',
      '<stop offset="56%" stop-color="#090706"/>',
      '<stop offset="100%" stop-color="#1b0d08"/>'
    ]
    : [
      '<stop offset="0%" stop-color="#fff8f2"/>',
      '<stop offset="56%" stop-color="#fff1e7"/>',
      '<stop offset="100%" stop-color="#ffe2cf"/>'
    ]

  return {
    body: [
      `<rect ${tileRect(offset, size, radius)} fill="url(#${id}-industrial-base)"/>`,
      `<g clip-path="url(#${id}-clip)">`,
      ...cells,
      '</g>',
      `<rect ${tileRect(offset + 0.75, size - 1.5, Math.max(0, radius - 0.75))} fill="none" stroke="${
        mode === 'dark' ? 'rgba(255,178,80,0.2)' : 'rgba(128,42,8,0.16)'
      }" stroke-width="${formatNumber(Math.max(0.6, size / 512))}"/>`
    ],
    defs: [
      `<linearGradient id="${id}-industrial-base" x1="0%" y1="0%" x2="100%" y2="100%">`,
      ...baseStops,
      '</linearGradient>'
    ]
  }
}

const createCells = (offset: number, size: number, mode: string, seed: string): string[] => {
  const rng = createSeededRandom(`${seed}:industrial-svg`)
  const cells: string[] = []
  const count = 8
  const gap = size * 0.018
  const cell = (size - gap * (count + 1)) / count
  const cool: ColorRgb = mode === 'dark' ? [31, 12, 7] : [255, 239, 221]
  const hot: ColorRgb = mode === 'dark' ? [255, 98, 24] : [223, 54, 16]

  for (let row = 0; row < count; row += 1) {
    for (let col = 0; col < count; col += 1) {
      const value = 0.2 + rng() * 0.8
      const r = Math.round(cool[0] + (hot[0] - cool[0]) * value)
      const g = Math.round(cool[1] + (hot[1] - cool[1]) * value)
      const b = Math.round(cool[2] + (hot[2] - cool[2]) * value)
      const x = offset + gap + col * (cell + gap)
      const y = offset + gap + row * (cell + gap)
      cells.push(
        `<rect x="${formatNumber(x)}" y="${formatNumber(y)}" width="${formatNumber(cell)}" height="${
          formatNumber(cell)
        }" fill="rgb(${r},${g},${b})" opacity="${
          formatNumber(mode === 'dark' ? 0.2 + value * 0.5 : 0.18 + value * 0.42)
        }"/>`
      )
    }
  }

  return cells
}
