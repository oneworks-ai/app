import { Button } from 'antd'
import type { ReactNode } from 'react'

export function DockPanelHeader({
  actions,
  closeLabel,
  closeIcon = 'disabled_by_default',
  fullscreenEnterLabel,
  fullscreenExitLabel,
  fullscreenMinimizedIcon = 'open_in_full',
  fullscreenMinimizedLabel,
  isFullscreen,
  isMinimized = false,
  meta,
  onClose,
  onToggleFullscreen,
  title
}: {
  actions?: ReactNode
  closeIcon?: string
  closeLabel?: string
  fullscreenEnterLabel?: string
  fullscreenExitLabel?: string
  fullscreenMinimizedIcon?: string
  fullscreenMinimizedLabel?: string
  isFullscreen: boolean
  isMinimized?: boolean
  meta?: ReactNode
  onClose?: () => void
  onToggleFullscreen?: () => void
  title?: ReactNode
}) {
  const fullscreenLabel = isMinimized
    ? fullscreenMinimizedLabel ?? fullscreenEnterLabel
    : isFullscreen
    ? fullscreenExitLabel
    : fullscreenEnterLabel
  const fullscreenIcon = isMinimized
    ? fullscreenMinimizedIcon
    : isFullscreen
    ? 'fullscreen_exit'
    : 'fullscreen'

  return (
    <div className='dock-panel__header'>
      <div className='dock-panel__header-main'>
        {title != null && <div className='dock-panel__title'>{title}</div>}
        {meta != null && (
          <span className='dock-panel__meta'>{meta}</span>
        )}
      </div>
      <div className='dock-panel__header-spacer' />
      {(actions != null || onToggleFullscreen != null || onClose != null) && (
        <div className='dock-panel__header-actions'>
          {actions}
          {onToggleFullscreen != null && fullscreenLabel != null && (
            <Button
              type='text'
              className='dock-panel__close-btn dock-panel__fullscreen-btn'
              data-dock-panel-no-resize='true'
              icon={<span className='material-symbols-rounded'>{fullscreenIcon}</span>}
              title={fullscreenLabel}
              aria-label={fullscreenLabel}
              onClick={onToggleFullscreen}
            />
          )}
          {onClose != null && closeLabel != null && (
            <Button
              type='text'
              className={[
                'dock-panel__close-btn',
                closeIcon === 'bottom_panel_close' || closeIcon === 'bottom_panel_open'
                  ? 'dock-panel__minimize-btn'
                  : ''
              ].filter(Boolean).join(' ')}
              data-dock-panel-no-resize='true'
              icon={<span className='material-symbols-rounded'>{closeIcon}</span>}
              title={closeLabel}
              aria-label={closeLabel}
              onClick={onClose}
            />
          )}
        </div>
      )}
    </div>
  )
}
