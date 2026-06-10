import type { CanvasRenderer } from './canvas.js'
import type {
  MobiusCore,
  OneWorksIconAppearance,
  OneWorksIconBackgroundStyle,
  OneWorksIconMode,
  OneWorksIconTheme
} from './types.js'

export interface OneWorksIconLoaderOptions {
  appearance?: OneWorksIconAppearance
  autoStart?: boolean
  background?: boolean | OneWorksIconBackgroundStyle
  canvasClassName?: string
  className?: string
  fullscreen?: boolean
  mode?: OneWorksIconMode
  motion?: boolean
  random?: boolean
  respectReducedMotion?: boolean
  seed?: string | null
  shadow?: boolean
  size?: number | string
  theme?: OneWorksIconTheme
}

export interface OneWorksIconLoaderHandle {
  readonly canvas: HTMLCanvasElement
  readonly core: MobiusCore
  readonly renderer: CanvasRenderer
  readonly seed: string
  dispose: () => void
  redraw: (time?: number) => void
  start: () => void
  stop: () => void
  update: (nextOptions: OneWorksIconLoaderOptions) => void
}

export interface NormalizedLoaderOptions {
  appearance: OneWorksIconAppearance
  autoStart: boolean
  background: boolean
  backgroundStyle: OneWorksIconBackgroundStyle
  canvasClassName: string
  className: string
  fullscreen: boolean
  mode?: OneWorksIconMode
  motion: boolean
  random: boolean
  respectReducedMotion: boolean
  seed: string | null
  shadow: boolean
  size?: number | string
  theme: OneWorksIconTheme
}
