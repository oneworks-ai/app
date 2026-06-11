import { MOBIUS_W, MOBIUS_Z } from './core-constants.js'
import type { ColorRgb } from './types.js'

export const themeFill = (
  theme: string,
  mode: string,
  depth: number,
  u: number,
  v: number,
  time: number
): string => {
  const over = 0.5 + 0.5 * (depth / (MOBIUS_Z + MOBIUS_W))
  const twistLight = 0.5 + 0.5 * Math.cos(u - 0.55)
  const rim = Math.abs(v) / MOBIUS_W
  const pulse = 0.5 + 0.5 * Math.cos(u + time * 0.68)

  if (theme === 'industrial') {
    const emphasis = clamp(0.74 * over + 0.14 * twistLight + 0.08 * rim + 0.04 * pulse)
    const palette: ColorRgb[] = mode === 'light'
      ? [[255, 230, 202], [255, 146, 58], [229, 58, 18], [82, 21, 9]]
      : [[20, 9, 6], [108, 22, 12], [226, 63, 18], [255, 145, 35]]

    if (emphasis < 0.44) return rgb(mixColor(palette[0], palette[1], emphasis / 0.44))
    if (emphasis < 0.78) return rgb(mixColor(palette[1], palette[2], (emphasis - 0.44) / 0.34))
    return rgb(mixColor(palette[2], palette[3], (emphasis - 0.78) / 0.22))
  }

  if (theme === 'matrix') {
    const emphasis = clamp(0.76 * over + 0.12 * twistLight + 0.08 * rim + 0.04 * pulse)
    const palette: ColorRgb[] = mode === 'light'
      ? [[212, 255, 226], [38, 226, 112], [0, 146, 70], [0, 72, 40]]
      : [[2, 18, 10], [0, 86, 44], [0, 214, 96], [168, 255, 198]]

    if (emphasis < 0.36) return rgb(mixColor(palette[0], palette[1], emphasis / 0.36))
    if (emphasis < 0.78) return rgb(mixColor(palette[1], palette[2], (emphasis - 0.36) / 0.42))
    return rgb(mixColor(palette[2], palette[3], (emphasis - 0.78) / 0.22))
  }

  if (theme === 'metal') {
    const edgeReflection = rim ** 1.6
    const longReflection = 0.5 + 0.5 * Math.cos(u * 2.1 - 0.72)
    const hardHighlight = Math.max(0, Math.cos(u * 3.2 + v * 2.4 - 1.1)) ** 10
    const hairline = 0.025 * Math.sin(u * 54 + v * 18)
    const emphasis = clamp(
      0.62 * over +
        0.14 * twistLight +
        0.12 * edgeReflection +
        0.08 * longReflection +
        0.13 * hardHighlight +
        hairline
    )
    const palette: ColorRgb[] = mode === 'light'
      ? [[34, 39, 42], [79, 88, 90], [159, 165, 162], [250, 248, 236], [72, 78, 79]]
      : [[8, 10, 11], [42, 47, 49], [139, 148, 147], [248, 247, 238], [82, 89, 91]]

    if (emphasis < 0.34) return rgb(mixColor(palette[0], palette[1], emphasis / 0.34))
    if (emphasis < 0.62) return rgb(mixColor(palette[1], palette[2], (emphasis - 0.34) / 0.28))
    if (emphasis < 0.82) return rgb(mixColor(palette[2], palette[3], (emphasis - 0.62) / 0.2))
    return rgb(mixColor(palette[3], palette[4], (emphasis - 0.82) / 0.18))
  }

  const emphasis = clamp(0.82 * over + 0.1 * twistLight + 0.08 * rim)
  const shade = mode === 'dark'
    ? Math.max(18, Math.min(242, Math.round(14 + 226 * emphasis)))
    : Math.max(18, Math.min(246, Math.round(248 - 226 * emphasis)))

  return `rgb(${shade},${shade},${shade})`
}

export const themeSolidBackgroundFill = (theme: string, mode: string): string => {
  if (theme === 'industrial') return mode === 'light' ? '#FFF1E8' : '#180804'
  if (theme === 'matrix') return mode === 'light' ? '#E9FFF1' : '#001B0D'
  if (theme === 'metal') return mode === 'light' ? '#F2F4F0' : '#111615'
  return mode === 'light' ? '#F3F5F2' : '#111514'
}

export const clamp = (value: number, min = 0, max = 1): number => Math.max(min, Math.min(max, value))

export const mixChannel = (start: number, end: number, amount: number): number =>
  Math.round(start + (end - start) * clamp(amount))

export const mixColor = (start: ColorRgb, end: ColorRgb, amount: number): ColorRgb => [
  mixChannel(start[0], end[0], amount),
  mixChannel(start[1], end[1], amount),
  mixChannel(start[2], end[2], amount)
]

export const rgb = (color: ColorRgb): string => `rgb(${color[0]},${color[1]},${color[2]})`

export const rgba = (color: ColorRgb, alpha: number): string => `rgba(${color[0]},${color[1]},${color[2]},${alpha})`
