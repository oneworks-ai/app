import type { KeyboardEvent as ReactKeyboardEvent } from 'react'

const IME_COMPOSITION_KEY_CODE = 229

type KeyboardEventLike = KeyboardEvent | ReactKeyboardEvent<Element>

export const isImeCompositionKeyEvent = (
  event: KeyboardEventLike,
  isCompositionActive = false
) => {
  const nativeEvent = 'nativeEvent' in event ? event.nativeEvent : event
  return isCompositionActive ||
    nativeEvent.isComposing ||
    nativeEvent.keyCode === IME_COMPOSITION_KEY_CODE
}

export const deferImeCompositionEnd = (setCompositionActive: (active: boolean) => void) => {
  window.setTimeout(() => {
    setCompositionActive(false)
  }, 0)
}
