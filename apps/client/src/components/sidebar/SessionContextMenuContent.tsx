import { renderIconAsset } from '#~/components/icons/IconAsset'
import type { IconAsset } from '#~/components/icons/IconAsset'

interface SessionContextMenuEntry {
  confirmLabel?: string
  danger?: boolean
  icon: IconAsset
  key: string
  label: string
  onClick: () => void
  type?: 'divider'
}

export function SessionContextMenuContent({
  entries,
  pendingAction,
  onCancelConfirm
}: {
  entries: SessionContextMenuEntry[]
  pendingAction: string | null
  onCancelConfirm: () => void
}) {
  return (
    <div className='session-context-menu ant-dropdown-menu' onContextMenu={(event) => event.preventDefault()}>
      {entries.map((entry) => {
        if (entry.type === 'divider') {
          return <div key={entry.key} className='session-context-menu__divider ant-dropdown-menu-item-divider' />
        }

        const isConfirming = pendingAction === entry.key
        return (
          <div
            key={entry.key}
            role='button'
            tabIndex={0}
            className={`session-context-menu__item ant-dropdown-menu-item session-context-menu__item--${entry.key} ${
              entry.danger ? 'is-danger' : ''
            } ${entry.danger ? 'ant-dropdown-menu-item-danger' : ''} ${
              isConfirming ? 'is-confirming ant-dropdown-menu-item-selected' : ''
            }`}
            onClick={(event) => {
              event.preventDefault()
              event.stopPropagation()
              entry.onClick()
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault()
                entry.onClick()
              }
            }}
          >
            <div className='session-context-menu__meta'>
              {renderIconAsset({
                active: false,
                className: 'session-context-menu__icon',
                icon: entry.icon
              })}
              <span className='session-context-menu__label'>
                {isConfirming ? (entry.confirmLabel ?? entry.label) : entry.label}
              </span>
            </div>
            {isConfirming && (
              <div className='session-context-menu__confirm-actions'>
                <button
                  type='button'
                  className='session-context-menu__confirm-btn is-accept'
                  onClick={(event) => {
                    event.preventDefault()
                    event.stopPropagation()
                    entry.onClick()
                  }}
                >
                  <span className='material-symbols-rounded'>check</span>
                </button>
                <button
                  type='button'
                  className='session-context-menu__confirm-btn is-cancel'
                  onClick={(event) => {
                    event.preventDefault()
                    event.stopPropagation()
                    onCancelConfirm()
                  }}
                >
                  <span className='material-symbols-rounded'>close</span>
                </button>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

export type { SessionContextMenuEntry }
