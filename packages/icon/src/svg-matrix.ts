import { createSeededRandom } from './core.js'
import type { SvgSection } from './svg-types.js'
import { formatNumber, tileRect } from './svg-utils.js'

export const createMatrixBackground = (
  id: string,
  offset: number,
  size: number,
  radius: number,
  mode: string,
  seed: string
): SvgSection => {
  const base = mode === 'dark' ? '#000000' : '#f7fff9'
  return {
    body: [
      `<rect ${tileRect(offset, size, radius)} fill="${base}"/>`,
      `<g clip-path="url(#${id}-clip)">`,
      `<rect ${tileRect(offset, size, radius)} fill="url(#${id}-matrix-glow)"/>`,
      ...createColumns(offset, size, mode, seed),
      '</g>',
      `<rect ${tileRect(offset + 0.75, size - 1.5, Math.max(0, radius - 0.75))} fill="none" stroke="${
        mode === 'dark' ? 'rgba(168,255,198,0.16)' : 'rgba(0,116,58,0.16)'
      }" stroke-width="${formatNumber(Math.max(0.6, size / 512))}"/>`
    ],
    defs: [
      `<radialGradient id="${id}-matrix-glow" cx="54%" cy="47%" r="55%">`,
      `  <stop offset="0%" stop-color="${mode === 'dark' ? '#00ff76' : '#00b454'}" stop-opacity="${
        mode === 'dark' ? '0.14' : '0.1'
      }"/>`,
      `  <stop offset="62%" stop-color="${mode === 'dark' ? '#00ff76' : '#00b454'}" stop-opacity="0.04"/>`,
      '  <stop offset="100%" stop-color="#00ff76" stop-opacity="0"/>',
      '</radialGradient>'
    ]
  }
}

const createColumns = (offset: number, size: number, mode: string, seed: string): string[] => {
  const rng = createSeededRandom(`${seed}:matrix-svg`)
  const columns: string[] = []
  const columnCount = 12
  const fontSize = Math.max(7, size * 0.045)
  const color = mode === 'dark' ? '#8cffb6' : '#00924a'

  for (let col = 0; col < columnCount; col += 1) {
    const x = offset + size * ((col + 0.5) / columnCount)
    const length = 3 + Math.floor(rng() * 7)
    const yStart = offset + size * rng() * 0.84
    for (let index = 0; index < length; index += 1) {
      const y = yStart + index * fontSize * 1.15
      if (y > offset + size - fontSize) break
      const alpha = (1 - index / length) * (mode === 'dark' ? 0.34 : 0.2)
      columns.push(
        `<text x="${formatNumber(x)}" y="${
          formatNumber(y)
        }" text-anchor="middle" font-family="ui-monospace, SFMono-Regular, Menlo, Consolas, monospace" font-size="${
          formatNumber(fontSize)
        }" fill="${color}" opacity="${formatNumber(alpha)}">${rng() > 0.5 ? '1' : '0'}</text>`
      )
    }
  }

  return columns
}
