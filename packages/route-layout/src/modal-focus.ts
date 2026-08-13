const MODAL_FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])'
].join(', ')

export const isModalFocusableElement = (element: HTMLElement) => (
  element.matches(MODAL_FOCUSABLE_SELECTOR) &&
  element.isConnected &&
  !element.hasAttribute('disabled') &&
  element.getAttribute('aria-hidden') !== 'true' &&
  element.closest('[hidden], [inert], [aria-hidden="true"]') == null &&
  element.offsetParent !== null
)

export const getModalFocusableElements = (container: HTMLElement) =>
  Array.from(container.querySelectorAll<HTMLElement>(MODAL_FOCUSABLE_SELECTOR))
    .filter(isModalFocusableElement)

export const focusModalElement = (element: HTMLElement) => {
  try {
    element.focus({ preventScroll: true })
  } catch {
    element.focus()
  }
}

export const focusFirstModalElement = (container: HTMLElement) => {
  const focusableElements = getModalFocusableElements(container)
  focusModalElement(focusableElements[0] ?? container)
  return focusableElements
}
