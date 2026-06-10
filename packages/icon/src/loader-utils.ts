import { resetRendererAtmosphere } from './canvas.js'
import type { CanvasRenderer } from './canvas.js'
import { normalizeSeed } from './core.js'
import type { NormalizedLoaderOptions, OneWorksIconLoaderOptions } from './loader-types.js'
import { DEFAULT_ICON_MODE, normalizeIconAppearance, normalizeIconMode, normalizeIconTheme } from './presets.js'
import type { MobiusCore, OneWorksIconBackgroundStyle, OneWorksIconMode } from './types.js'

export const scheduleFrame = (callback: FrameRequestCallback): number =>
  window.requestAnimationFrame?.(callback) ??
    window.setTimeout(() => callback(performance.now()), 16)

export const cancelFrame = (handle: number): void => {
  if (window.cancelAnimationFrame) {
    window.cancelAnimationFrame(handle)
  } else {
    window.clearTimeout(handle)
  }
}

const normalizeBackgroundStyle = (
  value: OneWorksIconLoaderOptions['background']
): OneWorksIconBackgroundStyle => {
  if (value === false || value === 'transparent') return 'transparent'
  if (value === 'solid') return 'solid'
  return 'textured'
}

export const toDatasetBackground = (backgroundStyle: OneWorksIconBackgroundStyle): string => {
  if (backgroundStyle === 'transparent') return 'none'
  if (backgroundStyle === 'solid') return 'solid'
  return 'tile'
}

export const normalizeLoaderOptions = (options: OneWorksIconLoaderOptions): NormalizedLoaderOptions => {
  const backgroundStyle = normalizeBackgroundStyle(options.background)
  return {
    appearance: normalizeIconAppearance(options.appearance),
    autoStart: options.autoStart ?? true,
    background: backgroundStyle !== 'transparent',
    backgroundStyle,
    canvasClassName: options.canvasClassName ?? 'oneworks-icon-loader__canvas',
    className: options.className ?? 'oneworks-icon-loader',
    fullscreen: options.fullscreen ?? false,
    mode: options.mode == null ? undefined : normalizeIconMode(options.mode),
    motion: options.motion ?? true,
    random: options.random ?? options.seed == null,
    respectReducedMotion: options.respectReducedMotion ?? true,
    seed: normalizeSeed(options.seed),
    shadow: options.shadow ?? true,
    size: options.size,
    theme: normalizeIconTheme(options.theme)
  }
}

export const createMediaQuery = (query: string): MediaQueryList | null =>
  typeof window === 'undefined' || !window.matchMedia ? null : window.matchMedia(query)

export const resolveMode = (
  options: NormalizedLoaderOptions,
  prefersDark: MediaQueryList | null
): OneWorksIconMode => {
  if (options.mode) return options.mode
  if (options.appearance === 'light' || options.appearance === 'dark') return options.appearance
  return prefersDark?.matches ? 'dark' : DEFAULT_ICON_MODE
}

export const shouldAnimate = (options: NormalizedLoaderOptions, prefersReducedMotion: MediaQueryList | null) =>
  options.motion && (!options.respectReducedMotion || !prefersReducedMotion?.matches)

export const applySize = (host: HTMLElement, size: number | string | undefined): void => {
  if (size == null) return
  const value = typeof size === 'number' ? `${size}px` : size
  host.style.width = value
  host.style.height = value
}

export const syncRendererOptions = (
  core: MobiusCore,
  host: HTMLElement,
  canvas: HTMLCanvasElement,
  renderer: CanvasRenderer,
  options: NormalizedLoaderOptions,
  mode: OneWorksIconMode
): void => {
  const themeChanged = renderer.theme !== options.theme
  const modeChanged = renderer.mode !== mode

  renderer.theme = options.theme
  renderer.mode = mode
  renderer.isStatic = !options.motion
  renderer.backgroundStyle = options.backgroundStyle
  renderer.noBackground = options.backgroundStyle === 'transparent'
  renderer.noShadow = !options.shadow
  renderer.isFullscreen = options.fullscreen
  canvas.dataset.theme = options.theme
  canvas.dataset.mode = mode
  canvas.dataset.background = toDatasetBackground(options.backgroundStyle)
  canvas.dataset.static = String(!options.motion)

  syncClasses(host, renderer)

  if ((themeChanged || modeChanged) && renderer.width > 0) {
    resetRendererAtmosphere(core, renderer)
  }
}

const syncClasses = (host: HTMLElement, renderer: CanvasRenderer): void => {
  host.classList.remove('metal', 'industrial', 'matrix', 'mode-light', 'mode-dark', 'no-bg', 'no-shadow', 'fullscreen')
  host.classList.add(renderer.theme, `mode-${renderer.mode}`)
  host.classList.toggle('no-bg', renderer.noBackground)
  host.classList.toggle('no-shadow', renderer.noShadow)
  host.classList.toggle('fullscreen', renderer.isFullscreen)
}
