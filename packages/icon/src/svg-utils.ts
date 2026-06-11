import type { MobiusQuad } from './types.js'

export const escapeXml = (value: unknown): string =>
  String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')

export const formatNumber = (value: number): string => Number(value.toFixed(3)).toString()

export const safeIdPart = (value: unknown): string =>
  String(value ?? '')
    .replace(/[^\w-]/g, '-')
    .slice(0, 36)

export const tileRect = (offset: number, size: number, radius: number): string =>
  `x="${formatNumber(offset)}" y="${formatNumber(offset)}" width="${formatNumber(size)}" height="${
    formatNumber(size)
  }" rx="${formatNumber(radius)}"`

export const quadPath = (quad: MobiusQuad, offset: number, scale: number): string => {
  const [first, ...rest] = quad.points.map(point => ({
    x: offset + point.x * scale,
    y: offset + point.y * scale
  }))
  if (!first) return ''

  const commands = [`M${formatNumber(first.x)} ${formatNumber(first.y)}`]
  for (const point of rest) {
    commands.push(`L${formatNumber(point.x)} ${formatNumber(point.y)}`)
  }

  commands.push('Z')
  return commands.join(' ')
}
