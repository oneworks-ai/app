import type { CanvasRenderer } from './canvas-types.js'
import { VIEW, themeFill, themeLinearBorder } from './core.js'
import { getLinearRibbonBorderQuad, overlapLinearRibbonBorderQuad } from './linear-ribbon.js'
import type { MobiusQuad } from './types.js'

export const drawSurface = (renderer: CanvasRenderer, time: number, mesh: MobiusQuad[]): void => {
  const { ctx, height, width } = renderer
  const scale = Math.min(width, height) / VIEW
  const offsetX = (width - VIEW * scale) / 2
  const offsetY = (height - VIEW * scale) / 2

  ctx.save()
  ctx.translate(offsetX, offsetY)
  ctx.scale(scale, scale)
  ctx.lineJoin = 'round'
  ctx.lineWidth = 0.9 / scale

  for (const quad of mesh) {
    drawQuad(renderer, quad, time, scale)
    if (renderer.theme === 'linear') drawLinearRibbonBorder(renderer, quad, scale)
  }

  ctx.restore()
}

const drawQuad = (renderer: CanvasRenderer, quad: MobiusQuad, time: number, scale: number): void => {
  const points = renderer.theme === 'linear' ? quad.outlinePoints ?? quad.points : quad.points
  const first = points[0]
  if (!first) return

  const fill = themeFill(renderer.theme, renderer.mode, quad.depth, quad.u, quad.v, time * 0.001)
  renderer.ctx.fillStyle = fill
  renderer.ctx.strokeStyle = fill
  renderer.ctx.lineWidth = (renderer.theme === 'linear' ? 0.4 : 0.9) / scale
  renderer.ctx.beginPath()
  renderer.ctx.moveTo(first.x, first.y)

  for (let i = 1; i < points.length; i += 1) {
    const point = points[i]
    if (point) renderer.ctx.lineTo(point.x, point.y)
  }

  renderer.ctx.closePath()
  renderer.ctx.fill()
  renderer.ctx.stroke()
}

const drawLinearRibbonBorder = (renderer: CanvasRenderer, quad: MobiusQuad, scale: number): void => {
  const borderQuad = getLinearRibbonBorderQuad(quad)
  if (borderQuad == null) return

  const { ctx } = renderer
  const [first, ...rest] = overlapLinearRibbonBorderQuad(borderQuad, 0.6 / scale)
  if (first == null) return

  ctx.fillStyle = themeLinearBorder(renderer.mode)
  ctx.beginPath()
  ctx.moveTo(first.x, first.y)
  for (const point of rest) ctx.lineTo(point.x, point.y)
  ctx.closePath()
  ctx.fill()
}
