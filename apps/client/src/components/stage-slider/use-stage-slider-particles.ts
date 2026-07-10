import type { CSSProperties } from 'react'
import { useEffect, useState } from 'react'

const TRACK_PARTICLE_COUNT = 14
const PARTICLE_TICK_MIN_MS = 320
const PARTICLE_TICK_RANGE_MS = 300

export interface StageSliderParticleStyle extends CSSProperties {
  '--stage-slider-particle-duration': string
  '--stage-slider-particle-duration-x': string
  '--stage-slider-particle-duration-y': string
  '--stage-slider-particle-easing-x': string
  '--stage-slider-particle-easing-y': string
  '--stage-slider-particle-left'?: string
  '--stage-slider-particle-opacity': string
  '--stage-slider-particle-scale': string
  '--stage-slider-particle-size': string
  '--stage-slider-particle-top'?: string
}

export interface StageSliderParticleField {
  track: ReadonlyArray<StageSliderParticleStyle>
}

const round = (value: number, precision = 2) => {
  const factor = 10 ** precision
  return Math.round(value * factor) / factor
}

const randomBetween = (random: () => number, min: number, max: number) => {
  return min + random() * (max - min)
}

const createRandomEasing = (random: () => number) => {
  const entryX = round(randomBetween(random, .18, .42))
  const entryY = round(randomBetween(random, .02, .38))
  const exitX = round(randomBetween(random, .58, .82))
  const exitY = round(randomBetween(random, .62, .98))
  return `cubic-bezier(${entryX}, ${entryY}, ${exitX}, ${exitY})`
}

const createMotionTiming = (random: () => number, min: number, max: number) => {
  const duration = randomBetween(random, min, max)

  return {
    '--stage-slider-particle-duration': `${round(duration)}s`,
    '--stage-slider-particle-duration-x': `${round(duration * randomBetween(random, .78, 1.24))}s`,
    '--stage-slider-particle-duration-y': `${round(duration * randomBetween(random, .78, 1.24))}s`,
    '--stage-slider-particle-easing-x': createRandomEasing(random),
    '--stage-slider-particle-easing-y': createRandomEasing(random)
  }
}

const createTrackParticle = (random: () => number): StageSliderParticleStyle => {
  return {
    ...createMotionTiming(random, .72, 1.55),
    '--stage-slider-particle-left': `${round(randomBetween(random, 2, 98), 1)}%`,
    '--stage-slider-particle-opacity': `${round(randomBetween(random, .34, 1))}`,
    '--stage-slider-particle-scale': `${round(randomBetween(random, .68, 1.3))}`,
    '--stage-slider-particle-size': `${round(randomBetween(random, 1.8, 3.4), 1)}px`,
    '--stage-slider-particle-top': `${round(randomBetween(random, 18, 82), 1)}%`
  }
}

export function createStageSliderParticleField(
  random: () => number = Math.random
): StageSliderParticleField {
  return {
    track: Array.from({ length: TRACK_PARTICLE_COUNT }, () => createTrackParticle(random))
  }
}

const moveParticleSubset = (
  particles: ReadonlyArray<StageSliderParticleStyle>,
  moveChance: number,
  createParticle: (random: () => number) => StageSliderParticleStyle,
  random: () => number
) => {
  let didMove = false
  const nextParticles = particles.map((particle) => {
    if (random() >= moveChance) {
      return particle
    }

    didMove = true
    return createParticle(random)
  })

  if (!didMove && nextParticles.length > 0) {
    const index = Math.floor(random() * nextParticles.length)
    nextParticles[index] = createParticle(random)
  }

  return nextParticles
}

export function advanceStageSliderParticleField(
  field: StageSliderParticleField,
  random: () => number = Math.random
): StageSliderParticleField {
  return {
    track: moveParticleSubset(field.track, .28, createTrackParticle, random)
  }
}

const createSeededRandom = (initialSeed: number) => {
  let seed = initialSeed >>> 0

  return () => {
    seed = (seed * 1_664_525 + 1_013_904_223) >>> 0
    return seed / 4_294_967_296
  }
}

const INITIAL_PARTICLE_FIELD = createStageSliderParticleField(createSeededRandom(0x5A17C9E3))

export function useStageSliderParticles(enabled: boolean) {
  const [particleField, setParticleField] = useState(INITIAL_PARTICLE_FIELD)

  useEffect(() => {
    if (!enabled) {
      return
    }

    const reducedMotionQuery = window.matchMedia?.('(prefers-reduced-motion: reduce)')
    let movementTimer: number | undefined

    const scheduleMovement = () => {
      if (reducedMotionQuery?.matches) {
        return
      }

      const delay = PARTICLE_TICK_MIN_MS + Math.random() * PARTICLE_TICK_RANGE_MS
      movementTimer = window.setTimeout(() => {
        setParticleField(field => advanceStageSliderParticleField(field))
        scheduleMovement()
      }, delay)
    }

    const handleMotionPreferenceChange = () => {
      window.clearTimeout(movementTimer)
      movementTimer = undefined
      scheduleMovement()
    }

    scheduleMovement()
    reducedMotionQuery?.addEventListener('change', handleMotionPreferenceChange)

    return () => {
      window.clearTimeout(movementTimer)
      reducedMotionQuery?.removeEventListener('change', handleMotionPreferenceChange)
    }
  }, [enabled])

  return particleField
}
