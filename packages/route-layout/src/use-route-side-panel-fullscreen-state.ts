import { useEffect, useState } from 'react'

const FULLSCREEN_TRANSITION_MS = 240

export type RouteSidePanelFullscreenRenderState = 'active' | 'entering' | 'exiting' | 'idle'

export function useRouteSidePanelFullscreenState({
  isClosing,
  isFullscreen
}: {
  isClosing: boolean
  isFullscreen: boolean
}) {
  const [fullscreenRenderState, setFullscreenRenderState] = useState<RouteSidePanelFullscreenRenderState>(() =>
    isFullscreen ? 'active' : 'idle'
  )

  useEffect(() => {
    if (isClosing) return

    if (isFullscreen) {
      setFullscreenRenderState(previousState => previousState === 'idle' ? 'entering' : 'active')
      const timeoutId = setTimeout(() => {
        setFullscreenRenderState('active')
      }, FULLSCREEN_TRANSITION_MS)

      return () => {
        clearTimeout(timeoutId)
      }
    }

    setFullscreenRenderState(previousState => previousState === 'idle' ? 'idle' : 'exiting')
    const timeoutId = setTimeout(() => {
      setFullscreenRenderState('idle')
    }, FULLSCREEN_TRANSITION_MS)

    return () => {
      clearTimeout(timeoutId)
    }
  }, [isClosing, isFullscreen])

  return fullscreenRenderState
}
