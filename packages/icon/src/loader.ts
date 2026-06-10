import { createCanvasRenderer, disposeRenderer, drawRenderer, resetRendererRandom, resizeRenderer } from './canvas.js'
import type { CreateCanvasRendererOptions } from './canvas.js'
import { createMobiusCore, createSessionSeed } from './core.js'
import type { NormalizedLoaderOptions, OneWorksIconLoaderHandle, OneWorksIconLoaderOptions } from './loader-types.js'
import {
  applySize,
  cancelFrame,
  createMediaQuery,
  normalizeLoaderOptions,
  resolveMode,
  scheduleFrame,
  shouldAnimate,
  syncRendererOptions,
  toDatasetBackground
} from './loader-utils.js'

export type { OneWorksIconLoaderHandle, OneWorksIconLoaderOptions } from './loader-types.js'

const TARGET_FRAME_MS = 1000 / 24

export const mountOneWorksIconLoader = (
  host: HTMLElement,
  initialOptions: OneWorksIconLoaderOptions = {}
): OneWorksIconLoaderHandle => {
  let options = normalizeLoaderOptions(initialOptions)
  const prefersReducedMotion = createMediaQuery('(prefers-reduced-motion: reduce)')
  const prefersDark = createMediaQuery('(prefers-color-scheme: dark)')
  const seed = options.random ? createSessionSeed() : options.seed ?? createSessionSeed()
  const core = createMobiusCore(seed)
  const canvas = document.createElement('canvas')
  const mode = resolveMode(options, prefersDark)

  canvas.className = options.canvasClassName
  canvas.dataset.theme = options.theme
  canvas.dataset.mode = mode
  canvas.dataset.background = toDatasetBackground(options.backgroundStyle)
  canvas.dataset.static = String(!options.motion)
  host.classList.add(options.className, 'mobiusLoader')
  applySize(host, options.size)
  host.appendChild(canvas)

  const renderer = createCanvasRenderer(core, canvas, createRendererOptions(options, mode))
  syncRendererOptions(core, host, canvas, renderer, options, mode)

  let disposed = false
  let frameHandle: number | null = null
  let lastDrawTime = -Infinity

  const drawAll = (time: number) => {
    const animationEnabled = shouldAnimate(options, prefersReducedMotion)
    const seconds = time * 0.001
    renderer.isStatic = !animationEnabled
    const motionAmount = renderer.isStatic ? 0 : 1
    const mesh = renderer.isStatic
      ? core.staticMesh
      : core.buildMesh(seconds, motionAmount, core.getMotionState(seconds, motionAmount, renderer))

    drawRenderer(core, renderer, renderer.isStatic ? 0 : time, mesh)
  }

  const requestFrame = () => {
    if (disposed || frameHandle != null) return
    frameHandle = scheduleFrame(drawFrame)
  }

  const drawFrame = (time: number) => {
    frameHandle = null
    if (time - lastDrawTime >= TARGET_FRAME_MS || lastDrawTime < 0) {
      lastDrawTime = time
      drawAll(time)
    }
    if (shouldAnimate(options, prefersReducedMotion)) requestFrame()
  }

  const redraw = (time = performance.now()) => {
    lastDrawTime = time
    drawAll(time)
    if (shouldAnimate(options, prefersReducedMotion)) requestFrame()
  }

  const stop = () => {
    if (frameHandle == null) return
    cancelFrame(frameHandle)
    frameHandle = null
  }

  const start = () => {
    if (!disposed) redraw()
  }

  const update = (nextOptions: OneWorksIconLoaderOptions) => {
    if (disposed) return
    const previous = options
    options = normalizeLoaderOptions({ ...options, background: options.backgroundStyle, ...nextOptions })
    resetSeedIfNeeded(previous, options, nextOptions)
    applySize(host, options.size)
    syncRendererOptions(core, host, canvas, renderer, options, resolveMode(options, prefersDark))
    redraw()
  }

  const handleResize = () => {
    if (disposed) return
    resizeRenderer(core, renderer)
    redraw()
  }

  const handleMediaChange = () => {
    if (disposed) return
    syncRendererOptions(core, host, canvas, renderer, options, resolveMode(options, prefersDark))
    redraw()
  }

  window.addEventListener('resize', handleResize)
  prefersReducedMotion?.addEventListener?.('change', handleMediaChange)
  prefersDark?.addEventListener?.('change', handleMediaChange)

  const dispose = () => {
    if (disposed) return
    disposed = true
    stop()
    window.removeEventListener('resize', handleResize)
    prefersReducedMotion?.removeEventListener?.('change', handleMediaChange)
    prefersDark?.removeEventListener?.('change', handleMediaChange)
    disposeRenderer(renderer)
    canvas.remove()
  }

  const resetSeedIfNeeded = (
    previous: NormalizedLoaderOptions,
    current: NormalizedLoaderOptions,
    nextOptions: OneWorksIconLoaderOptions
  ) => {
    if (nextOptions.random === true && !previous.random) {
      core.resetSeed(createSessionSeed())
      resetRendererRandom(core, renderer)
    } else if (current.seed && current.seed !== core.seed && current.random === false) {
      core.resetSeed(current.seed)
      resetRendererRandom(core, renderer)
    }
  }

  if (options.autoStart) start()

  return {
    get seed() {
      return core.seed
    },
    canvas,
    core,
    dispose,
    redraw,
    renderer,
    start,
    stop,
    update
  }
}

const createRendererOptions = (options: NormalizedLoaderOptions, mode: CreateCanvasRendererOptions['mode']) => ({
  backgroundStyle: options.backgroundStyle,
  fullscreen: options.fullscreen,
  mode,
  shadow: options.shadow,
  static: !options.motion,
  theme: options.theme
})
