import {
  LiquidMetalShapes,
  ShaderFitOptions,
  ShaderMount,
  getShaderColorFromString,
  liquidMetalFragmentShader
} from '@paper-design/shaders'
import type { ShaderMountUniforms } from '@paper-design/shaders'

import { drawPaperMetalImage } from './canvas-paper-metal-draw.js'
import type { CanvasRenderer, PaperMetalShader, ShaderMountControls } from './canvas-types.js'
import type { OneWorksIconMode } from './types.js'

const MAX_PIXEL_COUNT = 2048 * 2048
const SPEED = 0.24
const FULLSCREEN_BLEED = 320
const COMMON_UNIFORMS: ShaderMountUniforms = {
  u_angle: 138,
  u_colorTint: getShaderColorFromString('#ffffff'),
  u_contour: 0.68,
  u_distortion: 1,
  u_fit: ShaderFitOptions.contain,
  u_imageAspectRatio: 1,
  u_isImage: false,
  u_offsetX: 0,
  u_offsetY: 0,
  u_originX: 0.5,
  u_originY: 0.5,
  u_repetition: 2.36,
  u_rotation: 45,
  u_scale: 1.42,
  u_shape: LiquidMetalShapes.diamond,
  u_shiftBlue: 0.3,
  u_shiftRed: 0,
  u_softness: 1,
  u_worldHeight: 0,
  u_worldWidth: 0
}

let paperMetalHost: HTMLDivElement | null = null

export const drawPaperMetalBackground = (renderer: CanvasRenderer, time: number): boolean => {
  const shader = ensurePaperMetalShader(renderer)
  if (!shader) return false

  syncPaperMetalSize(renderer)
  syncPaperMetalUniforms(renderer, shader)

  const frame = renderer.isStatic ? 0 : (time + (renderer.motionOffset || 0) * 1000) * SPEED
  shader.mount.setFrame(frame)

  if (renderer.isFullscreen) {
    drawFullscreenShader(renderer, shader)
    return true
  }

  renderer.ctx.drawImage(shader.mount.canvasElement, 0, 0, renderer.width, renderer.height)
  return true
}

const metalColorBack = (mode: OneWorksIconMode) => getShaderColorFromString(mode === 'light' ? '#868986' : '#101112')
const metalColorTint = (mode: OneWorksIconMode) => getShaderColorFromString(mode === 'light' ? '#d4d2c5' : '#d8d7ca')

const createPaperMetalHost = (): HTMLDivElement => {
  const host = document.createElement('div')
  host.setAttribute('aria-hidden', 'true')
  Object.assign(host.style, {
    height: '1px',
    left: '-10000px',
    opacity: '0',
    overflow: 'hidden',
    pointerEvents: 'none',
    position: 'fixed',
    top: '0',
    width: '1px'
  })
  document.body.appendChild(host)
  return host
}

const ensurePaperMetalHost = (): HTMLDivElement | null => {
  if (!document.body) return null
  paperMetalHost ??= createPaperMetalHost()
  return paperMetalHost
}

const createPaperMetalUniforms = (renderer: CanvasRenderer): ShaderMountUniforms => {
  const isFullscreen = Boolean(renderer.isFullscreen)
  return {
    ...COMMON_UNIFORMS,
    u_colorBack: metalColorBack(renderer.mode),
    u_colorTint: metalColorTint(renderer.mode),
    u_fit: isFullscreen ? ShaderFitOptions.cover : ShaderFitOptions.contain,
    u_rotation: isFullscreen ? 0 : COMMON_UNIFORMS.u_rotation,
    u_scale: isFullscreen ? 1 : COMMON_UNIFORMS.u_scale,
    u_shape: isFullscreen ? LiquidMetalShapes.none : LiquidMetalShapes.diamond
  }
}

const paperMetalRenderSize = (renderer: CanvasRenderer) => {
  const width = Math.max(1, Math.round(renderer.width))
  const height = Math.max(1, Math.round(renderer.height))
  const bleed = renderer.isFullscreen ? FULLSCREEN_BLEED : 0
  return { bleed, height, renderHeight: height + bleed * 2, renderWidth: width + bleed * 2, width }
}

const syncPaperMetalSize = (renderer: CanvasRenderer): void => {
  const shader = renderer.paperMetalShader
  if (!shader) return

  const { renderWidth, renderHeight } = paperMetalRenderSize(renderer)
  const pixelCount = Math.min(MAX_PIXEL_COUNT, Math.max(1, Math.round(renderWidth * renderHeight * renderer.dpr ** 2)))
  if (
    shader.width === renderWidth && shader.height === renderHeight && shader.dpr === renderer.dpr &&
    shader.pixelCount === pixelCount
  ) {
    return
  }

  shader.width = renderWidth
  shader.height = renderHeight
  shader.dpr = renderer.dpr
  shader.pixelCount = pixelCount
  shader.host.style.width = `${renderWidth}px`
  shader.host.style.height = `${renderHeight}px`
  shader.mount.setMinPixelRatio(Math.max(1, renderer.dpr))
  shader.mount.setMaxPixelCount(pixelCount)
  shader.mount.parentWidth = renderWidth
  shader.mount.parentHeight = renderHeight
  shader.mount.devicePixelsSupported = false
  shader.mount.handleResize()
}

const ensurePaperMetalShader = (renderer: CanvasRenderer): PaperMetalShader | null => {
  if (renderer.paperMetalFailed) return null
  if (renderer.paperMetalShader) return renderer.paperMetalShader

  const host = ensurePaperMetalHost()
  if (!host) return null

  const shaderHost = document.createElement('div')
  shaderHost.style.width = '1px'
  shaderHost.style.height = '1px'
  shaderHost.style.borderRadius = 'inherit'
  host.appendChild(shaderHost)

  try {
    const mount = new ShaderMount(
      shaderHost,
      liquidMetalFragmentShader,
      createPaperMetalUniforms(renderer),
      {
        alpha: true,
        antialias: true,
        depth: false,
        premultipliedAlpha: true,
        preserveDrawingBuffer: true,
        stencil: false
      },
      0,
      0,
      Math.max(1, renderer.dpr),
      MAX_PIXEL_COUNT
    ) as unknown as ShaderMountControls
    renderer.paperMetalShader = {
      dpr: 0,
      fullscreen: Boolean(renderer.isFullscreen),
      height: 0,
      host: shaderHost,
      mode: renderer.mode,
      mount,
      pixelCount: 0,
      width: 0
    }
  } catch (error) {
    shaderHost.remove()
    renderer.paperMetalFailed = true
    console.warn('Paper Liquid Metal shader unavailable; using canvas fallback.', error)
    return null
  }

  return renderer.paperMetalShader
}

const syncPaperMetalUniforms = (renderer: CanvasRenderer, shader: PaperMetalShader): void => {
  const isFullscreen = Boolean(renderer.isFullscreen)
  if (shader.mode === renderer.mode && shader.fullscreen === isFullscreen) return
  shader.mode = renderer.mode
  shader.fullscreen = isFullscreen
  shader.mount.setUniforms(createPaperMetalUniforms(renderer))
}

const drawFullscreenShader = (renderer: CanvasRenderer, shader: PaperMetalShader): void => {
  const { bleed, height, width } = paperMetalRenderSize(renderer)
  drawPaperMetalImage(renderer, shader, bleed, width, height)
}
