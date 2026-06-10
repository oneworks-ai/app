import type { CanvasRenderer, HeatCell } from './canvas-types.js'
import { clamp, mixColor, rgba } from './core.js'
import type { ColorRgb, MobiusCore } from './types.js'

export const resetRain = (core: MobiusCore, renderer: CanvasRenderer): void => {
  const fontSize = renderer.width < 210 ? 11 : 13
  const count = Math.ceil(renderer.width / fontSize) + 1
  renderer.rainFontSize = fontSize
  renderer.rainColumns = Array.from({ length: count }, (_, index) => ({
    seed: core.randomRange(0, renderer.height + fontSize * 18),
    speed: core.randomRange(22, 58),
    length: Math.round(core.randomRange(7, 15)),
    alpha: core.randomRange(0.2, 0.72),
    x: index * fontSize + fontSize / 2
  }))
}

export const resetHeatmap = (core: MobiusCore, renderer: CanvasRenderer): void => {
  const cellSize = renderer.width < 170 ? 12 : 15
  const cols = Math.ceil(renderer.width / cellSize)
  const rows = Math.ceil(renderer.height / cellSize)
  renderer.heatCellSize = cellSize
  renderer.heatCols = cols
  renderer.heatRows = rows
  renderer.nextHeatUpdate = 0
  renderer.heatCells = Array.from({ length: cols * rows }, (_, index) => createHeatCell(core, cols, rows, index))
}

export const drawAtmosphere = (core: MobiusCore, renderer: CanvasRenderer, time: number): void => {
  if (renderer.backgroundStyle !== 'textured') return
  if (renderer.theme === 'matrix') {
    drawMatrixRain(renderer, time)
    return
  }
  if (renderer.theme === 'industrial') drawIndustrialHeatmap(core, renderer, time)
}

const createHeatCell = (core: MobiusCore, cols: number, rows: number, index: number): HeatCell => {
  const col = index % cols
  const row = Math.floor(index / cols)
  const x = (col + 0.5) / cols
  const y = (row + 0.5) / rows
  const value = clamp(heatSeedValue(x, y) + core.randomRange(-0.18, 0.18))
  return { speed: core.randomRange(0.035, 0.085), target: value, value }
}

const heatSeedValue = (x: number, y: number): number => {
  const leftHot = Math.exp(-((x - 0.34) ** 2 / 0.035 + (y - 0.52) ** 2 / 0.055))
  const rightHot = Math.exp(-((x - 0.66) ** 2 / 0.032 + (y - 0.42) ** 2 / 0.05))
  const lowerWarm = Math.exp(-((x - 0.54) ** 2 / 0.06 + (y - 0.68) ** 2 / 0.04))
  const diagonal = Math.max(0, 1 - Math.abs(y - (0.82 - x * 0.62)) * 3.8)
  return clamp(0.08 + leftHot * 0.46 + rightHot * 0.42 + lowerWarm * 0.22 + diagonal * 0.16)
}

const drawMatrixRain = (renderer: CanvasRenderer, time: number): void => {
  const { ctx, height, mode, rainColumns, rainFontSize, width } = renderer
  const isLight = mode === 'light'
  const glow = ctx.createRadialGradient(width * 0.54, height * 0.47, 0, width * 0.54, height * 0.47, width * 0.52)
  glow.addColorStop(0, isLight ? 'rgba(0,180,84,0.09)' : 'rgba(0,255,118,0.12)')
  glow.addColorStop(0.55, isLight ? 'rgba(0,180,84,0.035)' : 'rgba(0,255,118,0.045)')
  glow.addColorStop(1, 'rgba(0,255,118,0)')
  ctx.fillStyle = glow
  ctx.fillRect(0, 0, width, height)
  ctx.save()
  ctx.font = `${rainFontSize}px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'

  for (const column of rainColumns) {
    drawRainColumn(renderer, column.x, column.length, column.seed, column.speed, column.alpha, time)
  }
  ctx.restore()
}

const drawRainColumn = (
  renderer: CanvasRenderer,
  x: number,
  length: number,
  seed: number,
  speed: number,
  alphaSeed: number,
  time: number
): void => {
  const { ctx, height, mode, rainFontSize } = renderer
  const loopHeight = height + length * rainFontSize
  const head = ((time * 0.001 * speed + seed) % loopHeight) - length * rainFontSize
  for (let i = 0; i < length; i += 1) {
    const y = head - i * rainFontSize
    if (y < -rainFontSize || y > height + rainFontSize) continue

    const fade = 1 - i / length
    const glyphSeed = Math.sin(x * 12.9898 + i * 78.233 + Math.floor(time * 0.006) * 18.97)
    const color: ColorRgb = mode === 'light'
      ? i === 0 ? [0, 116, 58] : [0, 148, 72]
      : i === 0
      ? [215, 255, 226]
      : [116, 255, 168]
    const alpha = alphaSeed * fade * (i === 0 ? 0.74 : 0.42) * (mode === 'light' ? 0.52 : 1)
    ctx.fillStyle = rgba(color, alpha)
    ctx.fillText(glyphSeed > 0 ? '1' : '0', x, y)
  }
}

const drawIndustrialHeatmap = (core: MobiusCore, renderer: CanvasRenderer, time: number): void => {
  if (renderer.heatCells.length === 0) return
  updateHeatmap(core, renderer, time)

  const { ctx, heatCellSize, heatCols, heatRows, mode } = renderer
  const gap = Math.max(1, Math.round(heatCellSize * 0.14))
  const size = heatCellSize - gap
  ctx.save()
  ctx.globalCompositeOperation = 'source-over'

  for (let row = 0; row < heatRows; row += 1) {
    for (let col = 0; col < heatCols; col += 1) {
      const cell = renderer.heatCells[row * heatCols + col]
      if (!cell) continue
      if (!renderer.isStatic) cell.value += (cell.target - cell.value) * cell.speed
      const value = clamp(cell.value)
      ctx.fillStyle = rgba(heatColor(mode, value), mode === 'light' ? 0.22 + value * 0.48 : 0.18 + value * 0.64)
      ctx.fillRect(col * heatCellSize + gap / 2, row * heatCellSize + gap / 2, size, size)
    }
  }
  ctx.restore()
}

const updateHeatmap = (core: MobiusCore, renderer: CanvasRenderer, time: number): void => {
  if (renderer.isStatic || time < renderer.nextHeatUpdate) return
  renderer.nextHeatUpdate = time + core.randomRange(90, 170)
  for (const cell of renderer.heatCells) {
    if (core.random() >= 0.28) continue
    cell.target = clamp(cell.target + core.randomRange(-0.42, 0.42))
    cell.speed = core.randomRange(0.045, 0.12)
  }
}

const heatColor = (mode: string, value: number): ColorRgb => {
  const cool: ColorRgb = mode === 'light' ? [255, 239, 221] : [31, 12, 7]
  const warm: ColorRgb = mode === 'light' ? [255, 156, 55] : [124, 24, 12]
  const hot: ColorRgb = mode === 'light' ? [223, 54, 16] : [255, 98, 24]
  const peak: ColorRgb = mode === 'light' ? [96, 24, 10] : [255, 178, 56]
  if (value < 0.42) return mixColor(cool, warm, value / 0.42)
  if (value < 0.76) return mixColor(warm, hot, (value - 0.42) / 0.34)
  return mixColor(hot, peak, (value - 0.76) / 0.24)
}
