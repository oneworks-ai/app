import type { CanvasRenderer, PaperMetalShader } from './canvas-types.js'

export const drawPaperMetalImage = (
  renderer: CanvasRenderer,
  shader: PaperMetalShader,
  bleed: number,
  width: number,
  height: number
): void => {
  const renderScale = shader.mount.canvasElement.width / shader.width
  renderer.ctx.drawImage(
    shader.mount.canvasElement,
    bleed * renderScale,
    bleed * renderScale,
    width * renderScale,
    height * renderScale,
    0,
    0,
    width,
    height
  )
}
