interface DesktopQuitEvent {
  preventDefault: () => void
}

interface DesktopQuitCoordinatorInput {
  onShutdownError: (error: unknown) => void
  quit: () => void
  setIsQuitting: (isQuitting: boolean) => void
  shutdown: () => Promise<void>
}

export const createDesktopQuitCoordinator = ({
  onShutdownError,
  quit,
  setIsQuitting,
  shutdown
}: DesktopQuitCoordinatorInput) => {
  let shutdownComplete = false
  let shutdownPromise: Promise<void> | undefined

  const handleBeforeQuit = (event: DesktopQuitEvent) => {
    setIsQuitting(true)
    if (shutdownComplete) return

    event.preventDefault()
    if (shutdownPromise != null) return

    shutdownPromise = shutdown()
      .then(() => {
        shutdownComplete = true
        quit()
      })
      .catch((error) => {
        shutdownPromise = undefined
        setIsQuitting(false)
        onShutdownError(error)
      })
  }

  return {
    handleBeforeQuit
  }
}
