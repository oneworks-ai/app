import { useEffect } from 'react'

export const useDesktopUiReady = (ready = true) => {
  useEffect(() => {
    if (!ready) return
    void window.oneworksDesktop?.markDesktopUiReady?.()
  }, [ready])
}
