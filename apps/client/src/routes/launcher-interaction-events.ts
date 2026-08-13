interface LauncherOverlayActivationEvent {
  currentTarget: EventTarget
  preventDefault: () => void
  stopPropagation: () => void
  target: EventTarget
}

export const consumeLauncherOverlayBackdropPointerStart = (event: {
  currentTarget: EventTarget
  stopPropagation: () => void
  target: EventTarget
}) => {
  if (event.target === event.currentTarget) {
    event.stopPropagation()
  }
}

export const createLauncherOverlayBackdropActivationHandler = (input: {
  isOpen: boolean
  onRequestClose: () => void
}) =>
(event: LauncherOverlayActivationEvent) => {
  if (!input.isOpen || event.target !== event.currentTarget) return false

  event.preventDefault()
  event.stopPropagation()
  input.onRequestClose()
  return true
}

export const createLauncherEscapeHandler = (close: () => void) =>
(event: {
  defaultPrevented?: boolean
  key: string
  preventDefault: () => void
  stopPropagation: () => void
}) => {
  if (event.defaultPrevented === true || event.key !== 'Escape') return false

  event.preventDefault()
  event.stopPropagation()
  close()
  return true
}
