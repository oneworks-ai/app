import { useCallback, useEffect, useRef } from 'react'
export interface PanelTabCloseFocusIntent {
  externalFallbackLabel?: string
  familyRoot: HTMLElement | null
  invoker: HTMLElement | null
  invokerLabel?: string
  invokerTabId?: string
}
const isCssFocusHidden = (element: HTMLElement) => {
  const { display, opacity, pointerEvents, visibility } = window.getComputedStyle(element)
  return display === 'none' || opacity === '0' || pointerEvents === 'none' ||
    visibility === 'hidden' || visibility === 'collapse'
}
const isFocusable = (element: HTMLElement | null): element is HTMLElement => {
  if (element?.isConnected !== true) return false
  for (let current: HTMLElement | null = element; current != null; current = current.parentElement) {
    if (current.matches('[disabled], [hidden], [inert], [aria-hidden="true"]') || isCssFocusHidden(current)) {
      return false
    }
  }
  return true
}
const getDescendants = (root: HTMLElement) =>
  Array.from(root.getElementsByTagName('*')).filter((element): element is HTMLElement => element instanceof HTMLElement)
const findFocusable = (root: HTMLElement, matches: (element: HTMLElement) => boolean) =>
  getDescendants(root).find(element => matches(element) && isFocusable(element)) ?? null
const addFocusableCandidate = (candidates: HTMLElement[], element: HTMLElement | null) => {
  if (isFocusable(element) && !candidates.includes(element)) candidates.push(element)
}
const addFocusableMatches = (
  candidates: HTMLElement[],
  root: HTMLElement,
  matches: (element: HTMLElement) => boolean
) => getDescendants(root).forEach(element => matches(element) && addFocusableCandidate(candidates, element))
const hasAncestor = (
  element: HTMLElement,
  root: HTMLElement,
  matches: (ancestor: HTMLElement) => boolean
) => {
  let ancestor = element.parentElement
  while (ancestor != null) {
    if (matches(ancestor)) return true
    if (ancestor === root) return false
    ancestor = ancestor.parentElement
  }
  return false
}
const isMobileTabTarget = (element: HTMLElement, root: HTMLElement) =>
  element.tagName === 'BUTTON' &&
  (element.classList.contains('chat-workspace-drawer__mobile-tab-card-title') ||
    hasAncestor(element, root, ancestor =>
      ancestor.classList.contains('chat-workspace-drawer__mobile-tab-card') &&
      ancestor.classList.contains('is-active')))
const isCreateAction = (element: HTMLElement) => element.classList.contains('route-container-panel-dock__create-action')
const isDockTabClose = (element: HTMLElement) => element.classList.contains('route-container-panel-dock-tab__close')
const isPanelTabClose = (element: HTMLElement) =>
  isDockTabClose(element) || element.classList.contains('route-container-panel-tab__close')
const isEditorTarget = (element: HTMLElement) =>
  element.tagName === 'INPUT' || element.tagName === 'TEXTAREA' || element.getAttribute('contenteditable') === 'true'
const isGeneralFocusTarget = (element: HTMLElement) =>
  element.tagName === 'BUTTON' || element.getAttribute('tabindex') === '0'
const findTabContainer = (element: HTMLElement, root: HTMLElement) => {
  const container = element.closest<HTMLElement>('[data-route-container-panel-dock-tab-key]')
  return container != null && root.contains(container) ? container : null
}
const findSelectedTabTarget = (root: HTMLElement) => {
  const selected = getDescendants(root).find(element =>
    (element.dataset.routeContainerPanelDockTabKey != null &&
      hasAncestor(element, root, ancestor =>
        ancestor.classList.contains('dv-tab') && ancestor.classList.contains('dv-active-tab'))) ||
    (element.getAttribute('role') === 'tab' && element.getAttribute('aria-selected') === 'true')
  )
  if (selected == null) return null
  const container = findTabContainer(selected, root) ?? selected.parentElement
  const close = container == null ? null : findFocusable(container, isPanelTabClose)
  return close ?? (isFocusable(selected) ? selected : null)
}
export const capturePanelTabCloseFocus = (
  root: HTMLElement | null,
  externalFallbackLabel?: string
): PanelTabCloseFocusIntent => {
  const invoker = document.activeElement instanceof HTMLElement ? document.activeElement : null
  const tabElement = invoker?.closest<HTMLElement>('[data-route-container-panel-dock-tab-key]')
  return {
    ...(externalFallbackLabel == null ? {} : { externalFallbackLabel }),
    familyRoot: root?.closest<HTMLElement>('.route-container-layout') ?? null,
    invoker: invoker != null && root?.contains(invoker) === true ? invoker : null,
    ...(invoker?.getAttribute('aria-label') == null ? {} : { invokerLabel: invoker.getAttribute('aria-label')! }),
    ...(tabElement?.dataset.routeContainerPanelDockTabKey == null
      ? {}
      : { invokerTabId: tabElement.dataset.routeContainerPanelDockTabKey })
  }
}
const resolvePanelTabCloseFocus = ({
  getRoot,
  intent,
  preferredTabId
}: {
  getRoot: () => HTMLElement | null
  intent: PanelTabCloseFocusIntent
  preferredTabId?: string
}) => {
  const root = getRoot()
  if (root == null || !root.isConnected) return []
  const candidates: HTMLElement[] = []
  const targetTabId = preferredTabId ?? intent.invokerTabId
  if (targetTabId != null) {
    const tab = getDescendants(root).find(element => element.dataset.routeContainerPanelDockTabKey === targetTabId)
    const close = tab == null ? null : findFocusable(tab, isDockTabClose)
    addFocusableCandidate(candidates, close)
    const tabButton = tab == null ? null : findFocusable(tab, element => element.tagName === 'BUTTON')
    addFocusableCandidate(candidates, tabButton)
  }
  if (intent.invokerLabel != null) {
    const liveInvoker = findFocusable(root, element => element.getAttribute('aria-label') === intent.invokerLabel)
    addFocusableCandidate(candidates, liveInvoker)
  }
  addFocusableCandidate(candidates, intent.invoker != null && root.contains(intent.invoker) ? intent.invoker : null)
  addFocusableCandidate(candidates, findSelectedTabTarget(root))
  addFocusableCandidate(candidates, findFocusable(root, element => isMobileTabTarget(element, root)))
  addFocusableMatches(candidates, root, isCreateAction)
  addFocusableMatches(candidates, root, isEditorTarget)
  addFocusableMatches(candidates, root, isGeneralFocusTarget)
  addFocusableCandidate(candidates, root.tabIndex >= 0 ? root : null)
  const familyRoot = intent.familyRoot
  if (candidates.length === 0 && intent.externalFallbackLabel != null && familyRoot?.isConnected === true) {
    const externalFallback = findFocusable(
      familyRoot,
      element => element.getAttribute('aria-label') === intent.externalFallbackLabel && !root.contains(element)
    )
    addFocusableCandidate(candidates, externalFallback)
  }
  return candidates
}
interface PanelTabCloseFocusTarget {
  intent: PanelTabCloseFocusIntent
  preferredTabId?: string
}
export const focusPanelTabCloseTargetAfterReact = (
  options: PanelTabCloseFocusTarget & {
    getRoot: () => HTMLElement | null
    isCurrent?: () => boolean
  }
) => {
  let cancelled = false
  let firstFrameId: number | null = null
  let secondFrameId: number | null = null
  firstFrameId = window.requestAnimationFrame(() => {
    firstFrameId = null
    if (cancelled || options.isCurrent?.() === false) return
    secondFrameId = window.requestAnimationFrame(() => {
      secondFrameId = null
      if (cancelled || options.isCurrent?.() === false) return
      for (const target of resolvePanelTabCloseFocus(options)) {
        try {
          target.focus({ preventScroll: true })
          if (document.activeElement === target || target.contains(document.activeElement)) return
        } catch {
          // Continue to the next owner-local target when a host rejects focus.
        }
      }
    })
  })
  return () => {
    cancelled = true
    if (firstFrameId != null) window.cancelAnimationFrame(firstFrameId)
    if (secondFrameId != null) window.cancelAnimationFrame(secondFrameId)
    firstFrameId = secondFrameId = null
  }
}
export function usePanelTabCloseFocusScheduler({
  getRoot,
  ownerGeneration,
  ownerId
}: {
  getRoot: () => HTMLElement | null
  ownerGeneration: number
  ownerId: string
}) {
  const ownerKey = `${ownerId}:${ownerGeneration}`
  const latestGetRootRef = useRef(getRoot)
  const latestOwnerKeyRef = useRef(ownerKey)
  const cancelFocusRef = useRef<(() => void) | null>(null)
  latestGetRootRef.current = getRoot
  latestOwnerKeyRef.current = ownerKey
  const scheduleFocus = useCallback((target: PanelTabCloseFocusTarget) => {
    cancelFocusRef.current?.()
    const scheduledOwnerKey = ownerKey
    cancelFocusRef.current = focusPanelTabCloseTargetAfterReact({
      ...target,
      getRoot: () => latestGetRootRef.current(),
      isCurrent: () => latestOwnerKeyRef.current === scheduledOwnerKey
    })
  }, [ownerKey])
  useEffect(() => () => {
    cancelFocusRef.current?.()
    cancelFocusRef.current = null
  }, [ownerKey])
  return scheduleFocus
}
