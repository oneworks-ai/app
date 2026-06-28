import { useEffect, useRef } from 'react'

import 'luna-dom-highlighter/luna-dom-highlighter.css'
import LunaDomHighlighter from 'luna-dom-highlighter'

import { getOverlayStyle } from './mobile-device-preview-utils'
import type { MobileDeviceScreenDimensions } from './mobile-device-preview-utils'

const hoverHighlightOptions = {
  borderColor: 'rgba(56, 189, 248, .62)',
  contentColor: 'rgba(56, 189, 248, .12)',
  marginColor: 'rgba(56, 189, 248, 0)',
  monitorResize: true,
  paddingColor: 'rgba(56, 189, 248, 0)',
  showAccessibilityInfo: false,
  showExtensionLines: false,
  showInfo: false,
  showRulers: false,
  showStyles: false
}

const selectedHighlightOptions = {
  borderColor: 'rgba(34, 211, 238, .92)',
  contentColor: 'rgba(34, 211, 238, .18)',
  marginColor: 'rgba(34, 211, 238, 0)',
  monitorResize: true,
  paddingColor: 'rgba(34, 211, 238, 0)',
  showAccessibilityInfo: false,
  showExtensionLines: false,
  showInfo: false,
  showRulers: false,
  showStyles: false
}

type LunaDomHighlighterInternal = LunaDomHighlighter & {
  redraw?: EventListener
  removeAllListeners?: () => void
  resizeSensor?: {
    destroy: () => void
  }
}

const disposeLunaDomHighlighter = (
  highlighter: LunaDomHighlighterInternal,
  container: HTMLElement
) => {
  if (highlighter.redraw != null) {
    window.removeEventListener('resize', highlighter.redraw)
    window.removeEventListener('scroll', highlighter.redraw)
  }
  highlighter.resizeSensor?.destroy()
  highlighter.removeAllListeners?.()
  container.replaceChildren()
}

const useLunaDomHighlighter = (
  containerRef: React.RefObject<HTMLElement>,
  targetRef: React.RefObject<HTMLElement>,
  options: ConstructorParameters<typeof LunaDomHighlighter>[1],
  dependencies: unknown[]
) => {
  const highlighterRef = useRef<LunaDomHighlighter>()

  useEffect(() => {
    const container = containerRef.current
    if (container == null) return

    const highlighter = new LunaDomHighlighter(container, options)
    highlighterRef.current = highlighter
    return () => {
      disposeLunaDomHighlighter(highlighter as LunaDomHighlighterInternal, container)
      if (highlighterRef.current === highlighter) highlighterRef.current = undefined
    }
  }, [containerRef, options])

  useEffect(() => {
    const highlighter = highlighterRef.current
    if (highlighter == null) return

    const target = targetRef.current
    if (target == null) {
      highlighter.hide()
      return
    }
    highlighter.highlight(target)
  }, dependencies)
}

export function InteractionPanelMobileDeviceLunaHighlighter({
  hoverNode,
  screen,
  selectedNode
}: {
  hoverNode: DesktopMobileElementNode | undefined
  screen: MobileDeviceScreenDimensions | null
  selectedNode: DesktopMobileElementNode | undefined
}) {
  const hoverHighlighterContainerRef = useRef<HTMLSpanElement>(null)
  const selectedHighlighterContainerRef = useRef<HTMLSpanElement>(null)
  const hoverTargetRef = useRef<HTMLSpanElement>(null)
  const selectedTargetRef = useRef<HTMLSpanElement>(null)
  const hoverBounds = hoverNode?.bounds
  const selectedBounds = selectedNode?.bounds

  useLunaDomHighlighter(
    hoverHighlighterContainerRef,
    hoverTargetRef,
    hoverHighlightOptions,
    [hoverBounds, hoverNode?.id, screen]
  )
  useLunaDomHighlighter(
    selectedHighlighterContainerRef,
    selectedTargetRef,
    selectedHighlightOptions,
    [selectedBounds, selectedNode?.id, screen]
  )

  return (
    <>
      <span
        ref={hoverHighlighterContainerRef}
        aria-hidden='true'
        className='chat-interaction-panel-mobile-debug__luna-highlighter-layer is-hover'
      />
      <span
        ref={selectedHighlighterContainerRef}
        aria-hidden='true'
        className='chat-interaction-panel-mobile-debug__luna-highlighter-layer is-selected'
      />
      {screen != null && hoverBounds != null && (
        <span
          ref={hoverTargetRef}
          aria-hidden='true'
          className='chat-interaction-panel-mobile-debug__element-highlight-anchor is-hover'
          style={getOverlayStyle(hoverBounds, screen)}
        />
      )}
      {screen != null && selectedBounds != null && (
        <span
          ref={selectedTargetRef}
          aria-hidden='true'
          className='chat-interaction-panel-mobile-debug__element-highlight-anchor is-selected'
          style={getOverlayStyle(selectedBounds, screen)}
        />
      )}
    </>
  )
}
