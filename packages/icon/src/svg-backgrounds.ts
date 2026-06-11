import { createIndustrialBackground } from './svg-industrial.js'
import { createMatrixBackground } from './svg-matrix.js'
import { createMetalBackground } from './svg-metal.js'
import type { SvgSection } from './svg-types.js'

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
  return createMetalBackground(id, offset, size, radius, mode)
}
