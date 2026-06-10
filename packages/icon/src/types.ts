export type OneWorksIconAppearance = 'system' | 'light' | 'dark'
export type OneWorksIconBackgroundStyle = 'transparent' | 'solid' | 'textured'
export type OneWorksIconMode = 'light' | 'dark'
export type OneWorksIconTheme = 'metal' | 'industrial' | 'matrix'

export type ColorRgb = readonly [number, number, number]
export type Vec3 = readonly [number, number, number]

export interface MobiusSourcePoint {
  x: number
  y: number
  z: number
  u: number
  v: number
}

export interface MobiusProjectedPoint extends MobiusSourcePoint {
}

export interface MobiusQuad {
  points: MobiusProjectedPoint[]
  depth: number
  sortDepth: number
  u: number
  v: number
}

export interface MotionWave {
  amp: number
  uFreq: number
  timeFreq: number
  phase: number
}

export interface MotionCycleShape {
  xScale: number
  yScale: number
  lobeBalance: number
  waist: number
  diagonal: number
  depthScale: number
  phaseDrift: number
}

export interface MotionCycle {
  shape: MotionCycleShape
  twist: MotionWave[]
  width: MotionWave[]
  warpX: MotionWave[]
  warpY: MotionWave[]
  warpZ: MotionWave[]
}

export interface MotionSource {
  motionCycleIndex: number
  motionCycle: MotionCycle
  motionOffset: number
  motionLoopSeconds: number
}

export interface MotionState {
  envelope: number
  phase: number
  cycle: MotionCycle
}

export interface MobiusCore {
  readonly seed: string
  readonly staticMesh: MobiusQuad[]
  buildMesh: (time: number, motionAmount: number, motionState?: MotionState) => MobiusQuad[]
  createMotionCycle: () => MotionCycle
  createMotionSource: () => MotionSource
  getMotionState: (time: number, motionAmount: number, source?: MotionSource) => MotionState
  random: () => number
  randomRange: (min: number, max: number) => number
  resetMotionSource: (source: MotionSource) => void
  resetSeed: (nextSeed?: string | null) => string
}

export interface OneWorksIconRenderOptions {
  theme?: OneWorksIconTheme
  mode?: OneWorksIconMode
  backgroundStyle?: OneWorksIconBackgroundStyle
  noBackground?: boolean
  shadow?: boolean
  motion?: boolean
  frame?: number
  seed?: string | null
  size?: number
  title?: string
}
