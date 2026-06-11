export const openInteractionPanelExternalUrl = (url: string) => {
  if (typeof window === 'undefined' || url === '') return

  const opened = window.open(url, '_blank', 'noopener,noreferrer')
  if (opened == null) {
    if (window.oneworksDesktop != null) return

    window.location.assign(url)
    return
  }

  try {
    opened.opener = null
  } catch {
    // Ignore browsers that do not allow changing opener.
  }
  opened.focus()
}
