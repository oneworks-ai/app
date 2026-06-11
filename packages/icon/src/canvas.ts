import { drawAtmosphere, resetHeatmap, resetRain } from './canvas-atmosphere.js'
import { drawCanvasBackground } from './canvas-background.js'
import { drawSurface } from './canvas-surface.js'
import type { CanvasRenderer, CreateCanvasRendererOptions, CreateExportRendererOptions } from './canvas-types.js'
import { MOTION_LOOP_SECONDS } from './core.js'
import { normalizeIconMode, normalizeIconTheme } from './presets.js'
import type { MobiusCore, MobiusQuad, OneWorksIconBackgroundStyle } from './types.js'

export type { CanvasRenderer, CreateCanvasRendererOptions, CreateExportRendererOptions } from './canvas-types.js'

const getCanvasContext = (canvas: HTMLCanvasElement): CanvasRenderingContext2D => {
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Unable to create a 2D canvas context for the OneWorks icon renderer.')
  return ctx
}

const normalizeBackgroundStyle = (value: string | undefined): OneWorksIconBackgroundStyle => {
  if (value === 'none' || value === 'transparent') return 'transparent'
  if (value === 'solid') return 'solid'
  return 'textured'
}

const resolveBackgroundStyle = ({
  backgroundStyle,
  datasetBackground,
  noBackground
}: {
  backgroundStyle?: OneWorksIconBackgroundStyle
  datasetBackground?: string
  noBackground?: boolean
}): OneWorksIconBackgroundStyle => {
  if (backgroundStyle != null) return backgroundStyle
  if (noBackground != null) return noBackground ? 'transparent' : 'textured'
  return normalizeBackgroundStyle(datasetBackground)
}

export const createCanvasRenderer = (
  core: MobiusCore,
  canvas: HTMLCanvasElement,
  options: CreateCanvasRendererOptions = {}
): CanvasRenderer => {
  const theme = options.theme ?? normalizeIconTheme(canvas.dataset.theme)
  const mode = options.mode ?? normalizeIconMode(canvas.dataset.mode)
  const baseStatic = options.static ?? canvas.dataset.static === 'true'
  const baseBackgroundStyle = resolveBackgroundStyle({
    backgroundStyle: options.backgroundStyle,
    datasetBackground: canvas.dataset.background,
    noBackground: options.noBackground
  })
  const baseNoBackground = baseBackgroundStyle === 'transparent'

  return {
    ...core.createMotionSource(),
    backgroundStyle: baseBackgroundStyle,
    baseBackgroundStyle,
    baseNoBackground,
    baseStatic,
    canvas,
    ctx: getCanvasContext(canvas),
    dpr: 1,
    heatCellSize: 14,
    heatCells: [],
    heatCols: 0,
    heatRows: 0,
    height: 0,
    isFullscreen: options.fullscreen ?? false,
    isStatic: baseStatic,
    mode,
    nextHeatUpdate: 0,
    noBackground: baseNoBackground,
    noShadow: options.shadow === false,
    rainColumns: [],
    rainFontSize: 13,
    root: canvas.closest('.mobiusLoader'),
    theme,
    width: 0
  }
}

export const createExportRenderer = (core: MobiusCore, options: CreateExportRendererOptions): CanvasRenderer => {
  const canvas = document.createElement('canvas')
  canvas.width = options.size
  canvas.height = options.size
  const backgroundStyle = resolveBackgroundStyle({
    backgroundStyle: options.backgroundStyle,
    noBackground: options.noBackground
  })

  const renderer: CanvasRenderer = {
    backgroundStyle,
    baseBackgroundStyle: backgroundStyle,
    baseNoBackground: backgroundStyle === 'transparent',
    baseStatic: true,
    canvas,
    ctx: getCanvasContext(canvas),
    dpr: 1,
    heatCellSize: 14,
    heatCells: [],
    heatCols: 0,
    heatRows: 0,
    height: options.size,
    isFullscreen: false,
    isStatic: true,
    mode: options.mode,
    motionCycle: core.createMotionCycle(),
    motionCycleIndex: -1,
    motionLoopSeconds: MOTION_LOOP_SECONDS,
    motionOffset: 0,
    nextHeatUpdate: 0,
    noBackground: backgroundStyle === 'transparent',
    noShadow: false,
    rainColumns: [],
    rainFontSize: 13,
    root: null,
    theme: options.theme,
    width: options.size
  }

  if (options.theme === 'matrix') resetRain(core, renderer)
  if (options.theme === 'industrial') resetHeatmap(core, renderer)
  return renderer
}

export const disposeRenderer = (renderer: CanvasRenderer): void => {
  renderer.paperMetalShader?.mount.dispose()
  renderer.paperMetalShader?.host.remove()
  renderer.paperMetalShader = undefined
}

export const resetRendererRandom = (core: MobiusCore, renderer: CanvasRenderer): void => {
  core.resetMotionSource(renderer)
  resetRendererAtmosphere(core, renderer)
}

export const resetRendererAtmosphere = (core: MobiusCore, renderer: CanvasRenderer): void => {
  if (renderer.theme === 'matrix' && renderer.width > 0) resetRain(core, renderer)
  if (renderer.theme === 'industrial' && renderer.width > 0) resetHeatmap(core, renderer)
}

export const resizeRenderer = (core: MobiusCore, renderer: CanvasRenderer): void => {
  const rect = renderer.canvas.getBoundingClientRect()
  const width = Math.max(1, Math.round(rect.width))
  const height = Math.max(1, Math.round(rect.height))
  const pixelArea = width * height
  const maxDpr = pixelArea > 620000 ? 1 : pixelArea > 260000 ? 1.5 : 2
  const dpr = Math.min(window.devicePixelRatio || 1, maxDpr)

  if (
    width === renderer.width && height === renderer.height && dpr === renderer.dpr &&
    renderer.canvas.width === Math.round(width * dpr)
  ) {
    return
  }

  renderer.width = width
  renderer.height = height
  renderer.dpr = dpr
  renderer.canvas.width = Math.round(width * dpr)
  renderer.canvas.height = Math.round(height * dpr)
  renderer.ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  resetRendererAtmosphere(core, renderer)
}

export const drawRenderer = (core: MobiusCore, renderer: CanvasRenderer, time: number, mesh: MobiusQuad[]): void => {
  resizeRenderer(core, renderer)
  drawRendererFrame(core, renderer, time, mesh)
}

export const drawRendererFrame = (
  core: MobiusCore,
  renderer: CanvasRenderer,
  time: number,
  mesh: MobiusQuad[]
): void => {
  const { ctx, height, width } = renderer
  ctx.setTransform(renderer.dpr, 0, 0, renderer.dpr, 0, 0)
  ctx.clearRect(0, 0, width, height)
  drawCanvasBackground(renderer, time)
  drawAtmosphere(core, renderer, time)
  drawSurface(renderer, time, mesh)
}
