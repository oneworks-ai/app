import type { CanvasRenderer } from './canvas-types.js'
import { VIEW, themeFill } from './core.js'
import type { MobiusQuad } from './types.js'

export const drawSurface = (renderer: CanvasRenderer, time: number, mesh: MobiusQuad[]): void => {
  const { ctx, height, mode, theme, width } = renderer
  const scale = Math.min(width, height) / VIEW
  const offsetX = (width - VIEW * scale) / 2
  const offsetY = (height - VIEW * scale) / 2

  ctx.save()
  ctx.translate(offsetX, offsetY)
  ctx.scale(scale, scale)
  ctx.lineJoin = 'round'
  ctx.lineWidth = 0.9 / scale

  for (const quad of mesh) {
    drawQuad(renderer, quad, time)
  }

  ctx.restore()
}

const drawQuad = (renderer: CanvasRenderer, quad: MobiusQuad, time: number): void => {
  const first = quad.points[0]
  if (!first) return

  const fill = themeFill(renderer.theme, renderer.mode, quad.depth, quad.u, quad.v, time * 0.001)
  renderer.ctx.fillStyle = fill
  renderer.ctx.strokeStyle = fill
  renderer.ctx.beginPath()
  renderer.ctx.moveTo(first.x, first.y)

  for (let i = 1; i < quad.points.length; i += 1) {
    const point = quad.points[i]
    if (point) renderer.ctx.lineTo(point.x, point.y)
  }

  renderer.ctx.closePath()
  renderer.ctx.fill()
  renderer.ctx.stroke()
}
