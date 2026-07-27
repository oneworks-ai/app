import { MOBIUS_V_SEGMENTS, MOBIUS_W } from './core-constants.js'
import type { MobiusProjectedPoint, MobiusQuad } from './types.js'

const getVIndex = (quad: MobiusQuad) => {
  const vStep = (MOBIUS_W * 2) / MOBIUS_V_SEGMENTS
  return Math.round((quad.v + MOBIUS_W) / vStep - 0.5)
}

const interpolatePoint = (
  start: MobiusProjectedPoint,
  end: MobiusProjectedPoint,
  amount: number
): MobiusProjectedPoint => ({
  ...start,
  x: start.x + (end.x - start.x) * amount,
  y: start.y + (end.y - start.y) * amount,
  z: start.z + (end.z - start.z) * amount
})

export const getLinearRibbonBorderQuad = (quad: MobiusQuad): MobiusProjectedPoint[] | null => {
  const [lowerStart, lowerEnd, upperEnd, upperStart] = quad.outlinePoints ?? quad.points
  const vIndex = getVIndex(quad)

  if (lowerStart == null || lowerEnd == null || upperEnd == null || upperStart == null) return null
  if (vIndex === 0) {
    return [
      lowerStart,
      lowerEnd,
      interpolatePoint(lowerEnd, upperEnd, 0.42),
      interpolatePoint(lowerStart, upperStart, 0.42)
    ]
  }
  if (vIndex === MOBIUS_V_SEGMENTS - 1) {
    return [
      upperStart,
      upperEnd,
      interpolatePoint(upperEnd, lowerEnd, 0.42),
      interpolatePoint(upperStart, lowerStart, 0.42)
    ]
  }
  return null
}

export const overlapLinearRibbonBorderQuad = (
  points: MobiusProjectedPoint[],
  amount: number
): MobiusProjectedPoint[] => {
  const [outerStart, outerEnd, innerEnd, innerStart] = points
  if (outerStart == null || outerEnd == null || innerEnd == null || innerStart == null) return points

  const extend = (
    start: MobiusProjectedPoint,
    end: MobiusProjectedPoint,
    direction: -1 | 1
  ): MobiusProjectedPoint => {
    const dx = end.x - start.x
    const dy = end.y - start.y
    const length = Math.hypot(dx, dy) || 1
    return {
      ...start,
      x: start.x + direction * (dx / length) * amount,
      y: start.y + direction * (dy / length) * amount
    }
  }

  return [
    extend(outerStart, outerEnd, -1),
    extend(outerEnd, outerStart, -1),
    extend(innerEnd, innerStart, -1),
    extend(innerStart, innerEnd, -1)
  ]
}
