import { drawPaperMetalBackground } from './canvas-paper-metal.js'
import type { CanvasRenderer } from './canvas-types.js'
import { themeSolidBackgroundFill } from './core.js'

export const drawCanvasBackground = (renderer: CanvasRenderer, time: number): void => {
  const { ctx, height, mode, theme, width } = renderer
  if (renderer.backgroundStyle === 'transparent') return

  if (renderer.backgroundStyle === 'solid') {
    ctx.fillStyle = themeSolidBackgroundFill(theme, mode)
    ctx.fillRect(0, 0, width, height)
    return
  }

  if (theme === 'industrial') {
    const base = ctx.createLinearGradient(0, 0, width, height)
    if (mode === 'light') {
      base.addColorStop(0, '#fff8f2')
      base.addColorStop(0.56, '#fff1e7')
      base.addColorStop(1, '#ffe2cf')
    } else {
      base.addColorStop(0, '#160b07')
      base.addColorStop(0.56, '#090706')
      base.addColorStop(1, '#1b0d08')
    }
    ctx.fillStyle = base
    ctx.fillRect(0, 0, width, height)
    return
  }

  if (theme === 'matrix') {
    ctx.fillStyle = mode === 'light' ? '#f7fff9' : '#000000'
    ctx.fillRect(0, 0, width, height)
    return
  }

  if (theme === 'metal') {
    drawMetalBackground(renderer, time)
    return
  }

  ctx.fillStyle = mode === 'light' ? '#ffffff' : '#050505'
  ctx.fillRect(0, 0, width, height)
}

const drawMetalBackground = (renderer: CanvasRenderer, time: number): void => {
  if (drawPaperMetalBackground(renderer, time)) return

  const { ctx, height, mode, width } = renderer
  const base = ctx.createLinearGradient(0, 0, 0, height)
  if (mode === 'light') {
    base.addColorStop(0, '#dcddd8')
    base.addColorStop(0.36, '#8e9792')
    base.addColorStop(0.68, '#ecece6')
    base.addColorStop(1, '#7f8985')
  } else {
    base.addColorStop(0, '#050607')
    base.addColorStop(0.38, '#343a39')
    base.addColorStop(0.68, '#0d0f10')
    base.addColorStop(1, '#626b68')
  }

  ctx.fillStyle = base
  ctx.fillRect(0, 0, width, height)
}
