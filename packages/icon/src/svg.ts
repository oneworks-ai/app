import { MOTION_LOOP_SECONDS, VIEW, createMobiusCore, themeFill, themeSolidBackgroundFill } from './core.js'
import { DEFAULT_ICON_SEED, DEFAULT_ICON_SIZE, normalizeIconMode, normalizeIconTheme } from './presets.js'
import { themeAccent } from './svg-accent.js'
import { createBackground } from './svg-backgrounds.js'
import { escapeXml, formatNumber, quadPath, safeIdPart, tileRect } from './svg-utils.js'
import type { MobiusQuad, MotionSource, OneWorksIconBackgroundStyle, OneWorksIconRenderOptions } from './types.js'

const createMesh = (seed: string, motion: boolean, frame: number): MobiusQuad[] => {
  const core = createMobiusCore(seed)
  const seconds = motion ? frame : 0
  if (!motion) return core.staticMesh

  const motionSource: MotionSource = {
    motionCycle: core.createMotionCycle(),
    motionCycleIndex: -1,
    motionLoopSeconds: MOTION_LOOP_SECONDS,
    motionOffset: 0
  }
  return core.buildMesh(seconds, 1, core.getMotionState(seconds, 1, motionSource))
}

const resolveBackgroundStyle = (
  backgroundStyle: OneWorksIconBackgroundStyle | undefined,
  noBackground: boolean | undefined
): OneWorksIconBackgroundStyle => {
  if (backgroundStyle != null) return backgroundStyle
  return noBackground === true ? 'transparent' : 'textured'
}

export const createMobiusSvg = (options: OneWorksIconRenderOptions = {}): string => {
  const seed = options.seed ?? DEFAULT_ICON_SEED
  const theme = normalizeIconTheme(options.theme)
  const mode = normalizeIconMode(options.mode)
  const backgroundStyle = resolveBackgroundStyle(options.backgroundStyle, options.noBackground)
  const noBackground = backgroundStyle === 'transparent'
  const shadow = options.shadow ?? true
  const motion = options.motion ?? false
  const frame = options.frame ?? 0
  const size = options.size ?? DEFAULT_ICON_SIZE
  const title = options.title ?? 'oneworks icon'
  const id = `oneworks-${safeIdPart(theme)}-${safeIdPart(mode)}-${safeIdPart(seed)}-${size}-${backgroundStyle}`
  const innerSize = shadow ? Math.round(size * (noBackground ? 0.86 : 0.82)) : size
  const offset = (size - innerSize) / 2
  const scale = innerSize / VIEW
  const radius = noBackground ? innerSize * 0.08 : innerSize * (28 / 260)
  const accent = themeAccent(theme, mode)
  const mesh = createMesh(seed, motion, frame)
  const defs = [
    `<clipPath id="${id}-clip"><rect ${tileRect(offset, innerSize, radius)}/></clipPath>`,
    `<filter id="${id}-tile-shadow" x="-35%" y="-35%" width="170%" height="170%">`,
    `  <feDropShadow dx="0" dy="${formatNumber(innerSize * 0.11)}" stdDeviation="${
      formatNumber(innerSize * 0.11)
    }" flood-color="${mode === 'dark' ? 'rgba(0,0,0,0.78)' : 'rgba(31,34,33,0.24)'}"/>`,
    `  <feDropShadow dx="0" dy="0" stdDeviation="${formatNumber(innerSize * 0.05)}" flood-color="${accent.glow}"/>`,
    '</filter>',
    `<filter id="${id}-surface-shadow" x="-30%" y="-30%" width="160%" height="160%">`,
    `  <feDropShadow dx="0" dy="${formatNumber(innerSize * 0.06)}" stdDeviation="${
      formatNumber(innerSize * 0.08)
    }" flood-color="rgba(0,0,0,0.24)"/>`,
    `  <feDropShadow dx="0" dy="0" stdDeviation="${formatNumber(innerSize * 0.06)}" flood-color="${accent.shadow}"/>`,
    '</filter>'
  ]
  const body: string[] = []

  if (backgroundStyle === 'textured') {
    const background = createBackground(theme, mode, id, offset, innerSize, radius, seed)
    defs.push(...background.defs)
    body.push(`<g${shadow ? ` filter="url(#${id}-tile-shadow)"` : ''}>`, ...background.body, '</g>')
  } else if (backgroundStyle === 'solid') {
    body.push(
      `<g${shadow ? ` filter="url(#${id}-tile-shadow)"` : ''}>`,
      `<rect ${tileRect(offset, innerSize, radius)} fill="${themeSolidBackgroundFill(theme, mode)}"/>`,
      '</g>'
    )
  }

  const surfacePaths = mesh.map((quad) => {
    const fill = themeFill(theme, mode, quad.depth, quad.u, quad.v, frame)
    return `<path d="${quadPath(quad, offset, scale)}" fill="${fill}" stroke="${fill}" stroke-width="${
      formatNumber(Math.max(0.5, size / 512))
    }"/>`
  })
  const surfaceFilter = noBackground && shadow ? ` filter="url(#${id}-surface-shadow)"` : ''
  body.push(`<g${surfaceFilter} shape-rendering="geometricPrecision" opacity="0.98">`, ...surfacePaths, '</g>')

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" role="img" aria-label="${
      escapeXml(title)
    }">`,
    `  <title>${escapeXml(title)}</title>`,
    '  <defs>',
    ...defs.map(line => `    ${line}`),
    '  </defs>',
    ...body.map(line => `  ${line}`),
    '</svg>',
    ''
  ].join('\n')
}
