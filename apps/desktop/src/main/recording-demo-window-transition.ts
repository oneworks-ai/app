import type { BrowserWindow, Rectangle } from 'electron'

type RecordingDemoWindow = Pick<
  BrowserWindow,
  | 'focus'
  | 'getBounds'
  | 'hide'
  | 'isDestroyed'
  | 'moveTop'
  | 'setBounds'
  | 'setOpacity'
  | 'show'
  | 'showInactive'
>

const transition = {
  duration: 520,
  frameMs: 16
}

const easeOutCubic = (progress: number) => 1 - (1 - progress) ** 3

const restoreSourceWindow = (sourceWindow: RecordingDemoWindow) => {
  if (sourceWindow.isDestroyed()) return
  sourceWindow.show()
  sourceWindow.focus()
}

export const runRecordingDemoWorkspaceTransition = async (input: {
  loadPromise: Promise<unknown>
  sourceWindow: RecordingDemoWindow
  targetBounds: Rectangle
  targetWindow: RecordingDemoWindow
}) => {
  const { loadPromise, sourceWindow, targetBounds, targetWindow } = input
  if (sourceWindow.isDestroyed() || targetWindow.isDestroyed()) return false

  const sourceBounds = sourceWindow.getBounds()
  targetWindow.setBounds(sourceBounds, false)
  targetWindow.setOpacity(0)
  targetWindow.showInactive()
  targetWindow.moveTop()
  try {
    await loadPromise
    if (targetWindow.isDestroyed()) {
      restoreSourceWindow(sourceWindow)
      return false
    }
  } catch (error) {
    if (!targetWindow.isDestroyed()) {
      targetWindow.setOpacity(1)
      targetWindow.hide()
    }
    restoreSourceWindow(sourceWindow)
    throw error
  }

  if (!sourceWindow.isDestroyed()) sourceWindow.hide()
  targetWindow.setOpacity(1)
  const startedAt = Date.now()
  const animationCompleted = await new Promise<boolean>((resolve) => {
    const animate = () => {
      if (targetWindow.isDestroyed()) {
        resolve(false)
        return
      }
      const progress = Math.min(1, (Date.now() - startedAt) / transition.duration)
      const easedProgress = easeOutCubic(progress)
      const interpolate = (from: number, to: number) => Math.round(from + (to - from) * easedProgress)
      targetWindow.setBounds({
        height: interpolate(sourceBounds.height, targetBounds.height),
        width: interpolate(sourceBounds.width, targetBounds.width),
        x: interpolate(sourceBounds.x, targetBounds.x),
        y: interpolate(sourceBounds.y, targetBounds.y)
      }, false)
      if (progress >= 1) {
        resolve(true)
        return
      }
      setTimeout(animate, transition.frameMs)
    }

    animate()
  })
  if (!animationCompleted || targetWindow.isDestroyed()) {
    restoreSourceWindow(sourceWindow)
    return false
  }
  targetWindow.show()
  targetWindow.focus()
  return true
}
