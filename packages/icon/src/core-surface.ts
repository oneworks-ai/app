import {
  MOBIUS_A,
  MOBIUS_B,
  MOBIUS_PARAM_PHASE,
  MOBIUS_UP,
  MOBIUS_U_SEGMENTS,
  MOBIUS_V_SEGMENTS,
  MOBIUS_W,
  MOBIUS_Z
} from './core-constants.js'
import type { MobiusProjectedPoint, MobiusQuad, MobiusSourcePoint, MotionState, MotionWave, Vec3 } from './types.js'

const motionWaveValue = (waves: readonly MotionWave[], u: number, phase: number) => {
  const t = Math.PI * 2 * phase
  return waves.reduce((sum, wave) => sum + wave.amp * Math.sin(wave.uFreq * u + wave.timeFreq * t + wave.phase), 0)
}

const center = (u: number, motionState: MotionState): Vec3 => {
  const { shape } = motionState.cycle
  const envelope = motionState.envelope || 0
  const phase = Math.PI * 2 * (motionState.phase || 0)
  const shiftedU = u + envelope * shape.phaseDrift * Math.sin(phase)
  const sinU = Math.sin(shiftedU)
  const cosU = Math.cos(shiftedU)
  const lobeSide = Math.tanh(1.8 * sinU)
  const waist = 1 - envelope * shape.waist * Math.cos(2 * shiftedU) ** 2
  const lobeScale = 1 + envelope * shape.lobeBalance * lobeSide
  const xScale = 1 + envelope * shape.xScale
  const yScale = 1 + envelope * shape.yScale * Math.sin(phase + 0.8)
  const zScale = 1 + envelope * shape.depthScale * Math.cos(phase + 0.35)
  const diagonal = envelope * shape.diagonal

  return [
    MOBIUS_A * xScale * lobeScale * waist * sinU + diagonal * Math.sin(3 * shiftedU + phase),
    MOBIUS_B * yScale * Math.sin(2 * shiftedU) * (1 - 0.16 * envelope * lobeSide),
    MOBIUS_Z * zScale * cosU + envelope * 0.08 * Math.sin(3 * shiftedU - phase)
  ]
}

const dcenter = (u: number, motionState: MotionState): Vec3 => {
  const epsilon = 0.001
  const before = center(u - epsilon, motionState)
  const after = center(u + epsilon, motionState)
  return [
    (after[0] - before[0]) / (2 * epsilon),
    (after[1] - before[1]) / (2 * epsilon),
    (after[2] - before[2]) / (2 * epsilon)
  ]
}

const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
const mul = (a: Vec3, scale: number): Vec3 => [a[0] * scale, a[1] * scale, a[2] * scale]
const cross = (
  a: Vec3,
  b: Vec3
): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]

const norm = (vector: Vec3): Vec3 => {
  const length = Math.hypot(vector[0], vector[1], vector[2]) || 1
  return [vector[0] / length, vector[1] / length, vector[2] / length]
}

export const buildPoints = (motionAmount: number, motionState: MotionState): MobiusSourcePoint[][] => {
  const rows: MobiusSourcePoint[][] = []
  const surfaceRoll = motionAmount ? Math.PI * 2 * motionState.phase * motionAmount : 0

  for (let i = 0; i < MOBIUS_U_SEGMENTS; i += 1) {
    const u = MOBIUS_PARAM_PHASE + (2 * Math.PI * i) / MOBIUS_U_SEGMENTS
    const c = center(u, motionState)
    const tangent = norm(dcenter(u, motionState))
    let normal = cross(MOBIUS_UP, tangent)
    normal = normal[0] ** 2 + normal[1] ** 2 + normal[2] ** 2 < 1e-6 ? [1, 0, 0] : norm(normal)

    const binormal = norm(cross(tangent, normal))
    const twist = motionState.envelope * motionWaveValue(motionState.cycle.twist, u, motionState.phase)
    const widthPulse = 1 +
      motionState.envelope * motionWaveValue(motionState.cycle.width, u, motionState.phase) +
      motionState.envelope * motionState.cycle.shape.waist * 0.28 * Math.sin(2 * u + Math.PI * 2 * motionState.phase)
    const phi = u / 2 + Math.PI * 0.1 + twist + surfaceRoll
    const widthVector = add(mul(normal, Math.cos(phi)), mul(binormal, Math.sin(phi)))
    const centerWarp: Vec3 = [
      motionState.envelope * motionWaveValue(motionState.cycle.warpX, u, motionState.phase),
      motionState.envelope * motionWaveValue(motionState.cycle.warpY, u, motionState.phase),
      motionState.envelope * motionWaveValue(motionState.cycle.warpZ, u, motionState.phase)
    ]
    const animatedCenter = add(c, centerWarp)
    const row: MobiusSourcePoint[] = []

    for (let j = 0; j <= MOBIUS_V_SEGMENTS; j += 1) {
      const v = -MOBIUS_W + (2 * MOBIUS_W * j) / MOBIUS_V_SEGMENTS
      const p = add(animatedCenter, mul(widthVector, v * widthPulse))
      row.push({ u, v, x: p[0], y: p[1], z: p[2] })
    }

    rows.push(row)
  }

  return rows
}

export const createProjection = (points: MobiusSourcePoint[][]) => {
  const flat = points.flat()
  const minX = Math.min(...flat.map(point => point.x))
  const maxX = Math.max(...flat.map(point => point.x))
  const minY = Math.min(...flat.map(point => point.y))
  const maxY = Math.max(...flat.map(point => point.y))
  const scale = Math.min(820 / (maxX - minX), 610 / (maxY - minY))
  const centerX = (minX + maxX) / 2
  const centerY = (minY + maxY) / 2

  return (point: MobiusSourcePoint): MobiusProjectedPoint => ({
    u: point.u,
    v: point.v,
    x: 512 + (point.x - centerX) * scale,
    y: 512 - ((point.y - centerY) * scale + point.z * scale * 0.045),
    z: point.z
  })
}

export const buildMesh = (
  motionAmount: number,
  motionState: MotionState,
  project: (point: MobiusSourcePoint) => MobiusProjectedPoint
): MobiusQuad[] => {
  const points = buildPoints(motionAmount, motionState)
  const mesh: MobiusQuad[] = []

  for (let i = 0; i < MOBIUS_U_SEGMENTS; i += 1) {
    const nextI = (i + 1) % MOBIUS_U_SEGMENTS
    const isClosingBand = nextI === 0

    for (let j = 0; j < MOBIUS_V_SEGMENTS; j += 1) {
      const quad = buildQuad(points, project, i, j, nextI, isClosingBand)
      if (!quad) continue
      const depth = quad.reduce((sum, point) => sum + point.z, 0) / 4
      const u = MOBIUS_PARAM_PHASE + (2 * Math.PI * (i + 0.5)) / MOBIUS_U_SEGMENTS
      const v = -MOBIUS_W + (2 * MOBIUS_W * (j + 0.5)) / MOBIUS_V_SEGMENTS
      mesh.push({ depth, points: expandedQuad(quad, 0.82), sortDepth: depth + 0.11 * Math.cos(u), u, v })
    }
  }

  return mesh.sort((a, b) => a.sortDepth - b.sortDepth || a.u - b.u || a.v - b.v)
}

const buildQuad = (
  points: MobiusSourcePoint[][],
  project: (point: MobiusSourcePoint) => MobiusProjectedPoint,
  i: number,
  j: number,
  nextI: number,
  isClosingBand: boolean
) => {
  const nextJ = isClosingBand ? MOBIUS_V_SEGMENTS - j : j
  const nextJ1 = isClosingBand ? MOBIUS_V_SEGMENTS - j - 1 : j + 1
  const row = points[i]
  const nextRow = points[nextI]
  const currentPoint = row?.[j]
  const nextPoint = nextRow?.[nextJ]
  const nextPoint1 = nextRow?.[nextJ1]
  const currentPoint1 = row?.[j + 1]
  return currentPoint && nextPoint && nextPoint1 && currentPoint1
    ? [project(currentPoint), project(nextPoint), project(nextPoint1), project(currentPoint1)]
    : null
}

const expandedQuad = (quad: MobiusProjectedPoint[], amount: number): MobiusProjectedPoint[] => {
  const centerX = quad.reduce((sum, point) => sum + point.x, 0) / quad.length
  const centerY = quad.reduce((sum, point) => sum + point.y, 0) / quad.length
  return quad.map((point) => {
    const dx = point.x - centerX
    const dy = point.y - centerY
    const length = Math.hypot(dx, dy) || 1
    return { ...point, x: point.x + (amount * dx) / length, y: point.y + (amount * dy) / length }
  })
}
