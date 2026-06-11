import type { MotionSource, OneWorksIconBackgroundStyle, OneWorksIconMode, OneWorksIconTheme } from './types.js'

export interface MatrixRainColumn {
  alpha: number
  length: number
  seed: number
  speed: number
  x: number
}

export interface HeatCell {
  speed: number
  target: number
  value: number
}

export interface ShaderMountControls {
  canvasElement: HTMLCanvasElement
  devicePixelsSupported: boolean
  handleResize: () => void
  parentHeight: number
  parentWidth: number
  dispose: () => void
  setFrame: (newFrame: number) => void
  setMaxPixelCount: (newMaxPixelCount?: number) => void
  setMinPixelRatio: (newMinPixelRatio?: number) => void
  setUniforms: (newUniforms: Record<string, unknown>) => void
}

export interface PaperMetalShader {
  dpr: number
  fullscreen: boolean
  height: number
  host: HTMLDivElement
  mode: OneWorksIconMode
  mount: ShaderMountControls
  pixelCount: number
  width: number
}

export interface CreateCanvasRendererOptions {
  backgroundStyle?: OneWorksIconBackgroundStyle
  fullscreen?: boolean
  mode?: OneWorksIconMode
  noBackground?: boolean
  shadow?: boolean
  static?: boolean
  theme?: OneWorksIconTheme
}

export interface CreateExportRendererOptions {
  backgroundStyle?: OneWorksIconBackgroundStyle
  mode: OneWorksIconMode
  noBackground: boolean
  size: number
  theme: OneWorksIconTheme
}

export interface CanvasRenderer extends MotionSource {
  baseBackgroundStyle: OneWorksIconBackgroundStyle
  baseNoBackground: boolean
  baseStatic: boolean
  canvas: HTMLCanvasElement
  ctx: CanvasRenderingContext2D
  dpr: number
  heatCellSize: number
  heatCells: HeatCell[]
  heatCols: number
  heatRows: number
  height: number
  isFullscreen: boolean
  isStatic: boolean
  mode: OneWorksIconMode
  nextHeatUpdate: number
  noBackground: boolean
  noShadow: boolean
  paperMetalFailed?: boolean
  paperMetalShader?: PaperMetalShader
  rainColumns: MatrixRainColumn[]
  rainFontSize: number
  root: Element | null
  theme: OneWorksIconTheme
  width: number
  backgroundStyle: OneWorksIconBackgroundStyle
}
