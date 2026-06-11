import { MOTION_LOOP_SECONDS } from './core-constants.js'
import { createMotionCycle, createMotionStatePhase } from './core-motion.js'
import { createSeededRandom, createSessionSeed, hashSeed, normalizeSeed } from './core-random.js'
import { buildMesh as buildSurfaceMesh, buildPoints, createProjection } from './core-surface.js'
import type { MobiusCore, MotionCycle, MotionSource, MotionState } from './types.js'

export * from './core-color.js'
export * from './core-constants.js'
export * from './core-random.js'

export const createMobiusCore = (seed: string | null = createSessionSeed()): MobiusCore => {
  let currentSeed = normalizeSeed(seed) ?? createSessionSeed()
  let random = createSeededRandom(currentSeed)
  let randomTools = createRandomTools(random)
  let baseMotionCycle = createMotionCycle(randomTools)

  const resetSeed = (nextSeed: string | null = createSessionSeed()) => {
    currentSeed = normalizeSeed(nextSeed) ?? createSessionSeed()
    random = createSeededRandom(currentSeed)
    randomTools = createRandomTools(random)
    baseMotionCycle = createMotionCycle(randomTools)
    return currentSeed
  }

  const getMotionState = (time: number, motionAmount: number, source?: MotionSource): MotionState => {
    const cycle = source?.motionCycle ?? baseMotionCycle
    if (motionAmount === 0) {
      return { cycle, envelope: 0, phase: 0 }
    }

    const phaseState = createMotionStatePhase(time, motionAmount, source?.motionOffset ?? 0, source?.motionLoopSeconds)
    if (source && source.motionCycleIndex < 0) {
      source.motionCycleIndex = phaseState.cycleIndex
    }
    return { cycle, envelope: phaseState.envelope, phase: phaseState.phase }
  }

  const createCoreMotionCycle = (): MotionCycle => createMotionCycle(randomTools)
  const staticMotionState: MotionState = { cycle: baseMotionCycle, envelope: 0, phase: 0 }
  const project = createProjection(buildPoints(0, staticMotionState))
  const buildMesh = (time: number, motionAmount: number, motionState = getMotionState(time, motionAmount)) =>
    buildSurfaceMesh(motionAmount, motionState, project)

  const createMotionSource = (): MotionSource => ({
    motionCycle: createCoreMotionCycle(),
    motionCycleIndex: -1,
    motionLoopSeconds: MOTION_LOOP_SECONDS,
    motionOffset: randomTools.randomRange(0, MOTION_LOOP_SECONDS)
  })

  const resetMotionSource = (source: MotionSource): void => {
    source.motionCycleIndex = -1
    source.motionCycle = createCoreMotionCycle()
    source.motionOffset = randomTools.randomRange(0, MOTION_LOOP_SECONDS)
    source.motionLoopSeconds = MOTION_LOOP_SECONDS
  }

  return {
    get seed() {
      return currentSeed
    },
    buildMesh,
    createMotionCycle: createCoreMotionCycle,
    createMotionSource,
    getMotionState,
    random: () => random(),
    randomRange: (min, max) => randomTools.randomRange(min, max),
    resetMotionSource,
    resetSeed,
    staticMesh: buildMesh(0, 0)
  }
}

const createRandomTools = (random: () => number) => {
  const randomRange = (min: number, max: number) => min + random() * (max - min)
  const randomChoice = (values: readonly number[]) => values[Math.floor(random() * values.length)] ?? values[0] ?? 0
  const signedRandomRange = (min: number, max: number) => randomRange(min, max) * (random() < 0.5 ? -1 : 1)
  return { random, randomChoice, randomRange, signedRandomRange }
}

export { createSeededRandom, createSessionSeed, hashSeed, normalizeSeed }
