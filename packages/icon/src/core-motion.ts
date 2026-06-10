import { MOTION_LOOP_SECONDS } from './core-constants.js'
import type { MotionCycle, MotionWave } from './types.js'

export interface MotionRandom {
  random: () => number
  randomChoice: (values: readonly number[]) => number
  randomRange: (min: number, max: number) => number
  signedRandomRange: (min: number, max: number) => number
}

const makeMotionWave = (
  random: MotionRandom,
  minAmp: number,
  maxAmp: number,
  uFreqs: readonly number[],
  timeFreqs: readonly number[]
): MotionWave => ({
  amp: random.signedRandomRange(minAmp, maxAmp),
  phase: random.randomRange(0, Math.PI * 2),
  timeFreq: random.randomChoice(timeFreqs),
  uFreq: random.randomChoice(uFreqs)
})

export const createMotionCycle = (random: MotionRandom): MotionCycle => ({
  shape: {
    depthScale: random.signedRandomRange(0.08, 0.22),
    diagonal: random.signedRandomRange(0.04, 0.12),
    lobeBalance: random.signedRandomRange(0.08, 0.2),
    phaseDrift: random.signedRandomRange(0.03, 0.09),
    waist: random.signedRandomRange(0.08, 0.2),
    xScale: random.signedRandomRange(0.08, 0.18),
    yScale: random.signedRandomRange(0.1, 0.22)
  },
  twist: [
    makeMotionWave(random, 0.1, 0.18, [1, 2, 3], [1, 2]),
    makeMotionWave(random, 0.04, 0.09, [2, 3, 4], [2, 3])
  ],
  warpX: [
    makeMotionWave(random, 0.02, 0.05, [1, 2], [1, 2]),
    makeMotionWave(random, 0.01, 0.025, [3, 4], [2, 3])
  ],
  warpY: [
    makeMotionWave(random, 0.018, 0.04, [1, 2], [1, 2]),
    makeMotionWave(random, 0.01, 0.02, [3, 4], [2, 3])
  ],
  warpZ: [
    makeMotionWave(random, 0.055, 0.12, [1, 2, 3], [1, 2]),
    makeMotionWave(random, 0.025, 0.055, [2, 3, 4], [2, 3])
  ],
  width: [
    makeMotionWave(random, 0.035, 0.06, [2, 3, 4], [1, 2]),
    makeMotionWave(random, 0.015, 0.03, [3, 4, 5], [2, 3])
  ]
})

export const createMotionStatePhase = (
  time: number,
  motionAmount: number,
  motionOffset: number,
  loopSeconds = MOTION_LOOP_SECONDS
) => {
  const localTime = time + motionOffset
  const cycleIndex = Math.floor(localTime / loopSeconds)
  const phase = (((localTime % loopSeconds) + loopSeconds) % loopSeconds) / loopSeconds
  const envelope = Math.sin(Math.PI * phase) ** 2
  return { cycleIndex, envelope: envelope * motionAmount, phase }
}
