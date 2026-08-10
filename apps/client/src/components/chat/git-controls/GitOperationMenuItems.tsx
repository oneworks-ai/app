import { OverlayAction } from '#~/components/overlay'

import type { GitOperationAction, GitOperationKind } from './git-operation-utils'

export function GitOperationMenuItems({
  actions,
  isRefreshDisabled,
  operationKinds,
  refreshLabel,
  onRefresh
}: {
  actions: Record<GitOperationKind, GitOperationAction>
  isRefreshDisabled: boolean
  operationKinds: GitOperationKind[]
  refreshLabel: string
  onRefresh: () => void
}) {
  return (
    <>
      {operationKinds.map(kind => {
        const action = actions[kind]
        return (
          <OverlayAction
            key={kind}
            className='chat-header-git__operation-row'
            disabled={action.disabled}
            onClick={action.onClick}
          >
            <div className='chat-header-git__operation-row-main'>
              <span className='chat-header-git__row-icon material-symbols-rounded'>{action.icon}</span>
              <span className='chat-header-git__row-title'>{action.label}</span>
            </div>
          </OverlayAction>
        )
      })}
      <OverlayAction
        aria-label={refreshLabel}
        className='chat-header-git__operation-row'
        disabled={isRefreshDisabled}
        onClick={onRefresh}
      >
        <div className='chat-header-git__operation-row-main'>
          <span aria-hidden='true' className='chat-header-git__row-icon material-symbols-rounded'>refresh</span>
          <span className='chat-header-git__row-title'>{refreshLabel}</span>
        </div>
      </OverlayAction>
    </>
  )
}
