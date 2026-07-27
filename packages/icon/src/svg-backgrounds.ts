import { createIndustrialBackground } from './svg-industrial.js'
import { createMatrixBackground } from './svg-matrix.js'
import { createMetalBackground } from './svg-metal.js'
import type { SvgSection } from './svg-types.js'
import { formatNumber, tileRect } from './svg-utils.js'

export const createBackground = (
  theme: string,
  mode: string,
  id: string,
  offset: number,
  size: number,
  radius: number,
  seed: string
): SvgSection => {
  if (theme === 'industrial') return createIndustrialBackground(id, offset, size, radius, mode, seed)
  if (theme === 'matrix') return createMatrixBackground(id, offset, size, radius, mode, seed)
  if (theme === 'linear') {
    return {
      body: [
        `<rect ${tileRect(offset, size, radius)} fill="${mode === 'light' ? '#F8FAFC' : '#080A0D'}" ` +
        `stroke="${mode === 'light' ? 'rgba(20,29,36,0.12)' : 'rgba(226,235,242,0.12)'}" ` +
        `stroke-width="${formatNumber(Math.max(1, size / 300))}"/>`
      ],
      defs: []
    }
  }
  return createMetalBackground(id, offset, size, radius, mode)
}
