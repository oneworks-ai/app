import type { CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'

const getBoundsViewport = (
  bounds: DesktopMobileElementBounds,
  rootBounds: DesktopMobileElementBounds | undefined
) => {
  if (rootBounds != null && rootBounds.width > 0 && rootBounds.height > 0) return rootBounds
  return {
    height: Math.max(bounds.y + bounds.height, bounds.height, 1),
    width: Math.max(bounds.x + bounds.width, bounds.width, 1),
    x: 0,
    y: 0
  }
}

export function InteractionPanelMobileDeviceBoundsModel({
  elementTree,
  node
}: {
  elementTree: DesktopMobileElementTreeResponse | null
  node: DesktopMobileElementNode | undefined
}) {
  const { t } = useTranslation()
  const bounds = node?.bounds

  if (node == null) {
    return (
      <div className='chat-interaction-panel-mobile-debug__element-empty'>
        {t('chat.interactionPanel.mobileDebugSelectElement')}
      </div>
    )
  }

  if (bounds == null) {
    return (
      <div className='chat-interaction-panel-mobile-debug__element-empty'>
        {t('chat.interactionPanel.mobileDebugNotAvailable')}
      </div>
    )
  }

  const viewport = getBoundsViewport(bounds, elementTree?.root?.bounds)
  const left = bounds.x - viewport.x
  const top = bounds.y - viewport.y
  const modelStyle = {
    '--mobile-debug-bounds-height': `${bounds.height / Math.max(1, viewport.height) * 100}%`,
    '--mobile-debug-bounds-left': `${left / Math.max(1, viewport.width) * 100}%`,
    '--mobile-debug-bounds-ratio': `${viewport.width} / ${viewport.height}`,
    '--mobile-debug-bounds-top': `${top / Math.max(1, viewport.height) * 100}%`,
    '--mobile-debug-bounds-width': `${bounds.width / Math.max(1, viewport.width) * 100}%`
  } as CSSProperties

  return (
    <div className='chat-interaction-panel-mobile-debug__bounds-model' style={modelStyle}>
      <div className='chat-interaction-panel-mobile-debug__bounds-stage'>
        <div className='chat-interaction-panel-mobile-debug__bounds-screen-label'>
          {t('chat.interactionPanel.mobileDebugBoundsScreen')} {viewport.width}x{viewport.height}
        </div>
        <div className='chat-interaction-panel-mobile-debug__bounds-node'>
          <span className='chat-interaction-panel-mobile-debug__bounds-node-origin'>
            {bounds.x}, {bounds.y}
          </span>
          <span className='chat-interaction-panel-mobile-debug__bounds-node-name'>
            {t('chat.interactionPanel.mobileDebugBoundsElement')}
          </span>
          <span className='chat-interaction-panel-mobile-debug__bounds-node-size'>
            {bounds.width} x {bounds.height}
          </span>
        </div>
      </div>
    </div>
  )
}
