const cursorPath =
  'M55.87 28.26C60.04 30.56 60.04 33.44 55.87 35.74L18.38 56.42C14.56 58.53 10.45 54.55 12.42 50.66L21.18 33.38C21.62 32.51 21.62 31.49 21.18 30.62L12.42 13.34C10.45 9.45 14.56 5.47 18.38 7.58L55.87 28.26Z'

function normalizeCursorColor(value) {
  if (typeof value !== 'string') throw new TypeError('Cursor color must be a CSS hex color such as #625BF6.')
  const normalized = value.trim().toUpperCase()
  if (/^#[0-9A-F]{6}$/.test(normalized)) return normalized
  const short = normalized.match(/^#([0-9A-F])([0-9A-F])([0-9A-F])$/)
  if (short == null) throw new TypeError('Cursor color must be a CSS hex color such as #625BF6.')
  return `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`
}

function resolveCursorBorderColor(fillColor) {
  const color = normalizeCursorColor(fillColor)
  const red = Number.parseInt(color.slice(1, 3), 16)
  const green = Number.parseInt(color.slice(3, 5), 16)
  const blue = Number.parseInt(color.slice(5, 7), 16)
  const luminance = ((0.2126 * red) + (0.7152 * green) + (0.0722 * blue)) / 255
  return luminance > 0.68 ? '#596273' : '#FFFFFF'
}

function createOneWorksCursorSvg({ borderColor, color, size = 256 }) {
  if (!Number.isFinite(size) || size <= 0) throw new TypeError('Cursor size must be a positive number.')
  const fill = normalizeCursorColor(color)
  const border = borderColor == null ? resolveCursorBorderColor(fill) : normalizeCursorColor(borderColor)
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 64 64" fill="none">\n  <g transform="rotate(-135 32 32)">\n    <path fill="${fill}" stroke="${border}" stroke-width="2.5" stroke-linejoin="round" d="${cursorPath}"/>\n  </g>\n</svg>\n`
}

module.exports = { createOneWorksCursorSvg, normalizeCursorColor, resolveCursorBorderColor }
