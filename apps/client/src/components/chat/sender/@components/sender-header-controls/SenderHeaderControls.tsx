import { useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { getAgentRoomConversationTargetPreview } from '#~/components/agent-room/@core/resolve-room-target'
import { useSenderHeaderQueryState } from '#~/hooks/use-sender-header-query-state.js'

import type { SenderProps } from '../../@types/sender-props'
import type {
  SenderToolbarData,
  SenderToolbarHandlers,
  SenderToolbarRefs,
  SenderToolbarState
} from '../../@types/sender-toolbar-types'
import { CollapsedPermissionModeStatus } from '../permission-mode-control/CollapsedPermissionModeStatus'
import { PermissionModeControl } from '../permission-mode-control/PermissionModeControl'
import { SenderSessionTargetBar } from '../session-target/SenderSessionTargetBar'

export function SenderHeaderControls({
  isInlineEdit,
  sessionTarget,
  toolbarState,
  toolbarData,
  toolbarRefs,
  toolbarHandlers,
  input,
  agentRoomTargetMembers
}: {
  isInlineEdit: boolean
  sessionTarget?: SenderProps['sessionTarget']
  toolbarState: SenderToolbarState
  toolbarData: SenderToolbarData
  toolbarRefs: SenderToolbarRefs
  toolbarHandlers: SenderToolbarHandlers
  input: string
  agentRoomTargetMembers?: SenderProps['agentRoomTargetMembers']
}) {
  const { t } = useTranslation()
  const { isHeaderCollapsed, setHeaderCollapsed } = useSenderHeaderQueryState()
  const showPermissionControl = !isInlineEdit && toolbarData.permissionModeOptions.length > 0
  const headerStateClass = isHeaderCollapsed ? 'is-collapsed' : 'is-expanded'
  const headerBlockClassName = `chat-input-header-block ${headerStateClass}`
  const selectedPermissionOption = toolbarData.permissionModeOptions.find(
    option => option.value === toolbarState.permissionMode
  )
  const agentRoomTargetPreview = useMemo(
    () =>
      agentRoomTargetMembers == null
        ? null
        : getAgentRoomConversationTargetPreview(input, agentRoomTargetMembers),
    [agentRoomTargetMembers, input]
  )
  const hasHeaderControls = !isInlineEdit && (agentRoomTargetPreview != null || sessionTarget != null ||
    showPermissionControl)

  useEffect(() => {
    if (showPermissionControl && isHeaderCollapsed && toolbarState.showPermissionActions) {
      setHeaderCollapsed(false)
    }
  }, [isHeaderCollapsed, setHeaderCollapsed, showPermissionControl, toolbarState.showPermissionActions])

  if (!hasHeaderControls) {
    return null
  }

  const headerActions = showPermissionControl
    ? (
      <div className='chat-input-header-actions'>
        <PermissionModeControl
          state={{
            showPermissionActions: toolbarState.showPermissionActions,
            permissionMode: toolbarState.permissionMode,
            permissionModeTransitionPending: toolbarState.permissionModeTransitionPending,
            selectionControlsDisabled: toolbarState.selectionControlsDisabled,
            canOpenReferenceActions: toolbarState.canOpenReferenceActions,
            isMac: toolbarState.isMac
          }}
          data={{
            permissionModeOptions: toolbarData.permissionModeOptions,
            composerControlShortcuts: toolbarData.composerControlShortcuts
          }}
          refs={{ permissionMenuNavigation: toolbarRefs.permissionMenuNavigation }}
          handlers={{
            onPermissionOpenChange: toolbarHandlers.onPermissionOpenChange,
            onPermissionMenuKeyDown: toolbarHandlers.onPermissionMenuKeyDown,
            onSelectPermissionMode: toolbarHandlers.onSelectPermissionMode
          }}
        />
      </div>
    )
    : null
  const headerToggleTabClassName = [
    'chat-input-header-toggle-tab',
    showPermissionControl && isHeaderCollapsed
      ? `chat-input-header-toggle-tab--permission-${toolbarState.permissionMode}`
      : ''
  ].filter(Boolean).join(' ')

  const toggleHeader = () => {
    if (!isHeaderCollapsed) {
      toolbarHandlers.onPermissionOpenChange(false)
    }
    setHeaderCollapsed(!isHeaderCollapsed)
  }

  const headerToggle = (
    <div className={`chat-input-header-toggle-shell ${headerStateClass}`}>
      {showPermissionControl && isHeaderCollapsed && (
        <CollapsedPermissionModeStatus
          permissionMode={toolbarState.permissionMode}
          selectedOption={selectedPermissionOption}
          transitionPending={toolbarState.permissionModeTransitionPending ||
            toolbarState.selectionControlsDisabled}
          onRestoreDefault={() => toolbarHandlers.onSelectPermissionMode('default')}
        />
      )}
      <button
        type='button'
        className={headerToggleTabClassName}
        aria-label={isHeaderCollapsed ? t('chat.expandHeaderControls') : t('chat.collapseHeaderControls')}
        aria-expanded={!isHeaderCollapsed}
        onClick={toggleHeader}
      >
        <span className='material-symbols-rounded'>
          {isHeaderCollapsed ? 'unfold_more' : 'unfold_less'}
        </span>
      </button>
    </div>
  )

  if (agentRoomTargetPreview != null) {
    return (
      <>
        <div
          className={`sender-session-target sender-room-target sender-room-target--${agentRoomTargetPreview.status} ${headerBlockClassName}`}
          aria-hidden={isHeaderCollapsed}
        >
          <div className='sender-session-target__controls sender-room-target__controls'>
            <span
              className={`sender-room-target__label sender-room-target__label--${agentRoomTargetPreview.status}`}
            >
              <span className='sender-room-target__icon' aria-hidden='true'>@</span>
              <span className='sender-room-target__copy'>
                {t(`agentRoom.composer.target.${agentRoomTargetPreview.status}`, {
                  target: agentRoomTargetPreview.targetLabel
                })}
              </span>
            </span>
            {headerActions != null && (
              <div className='sender-session-target__actions'>
                {headerActions}
              </div>
            )}
          </div>
        </div>
        {headerToggle}
      </>
    )
  }

  if (sessionTarget != null) {
    return (
      <>
        <SenderSessionTargetBar
          draft={sessionTarget.draft}
          locked={sessionTarget.locked}
          disabled={sessionTarget.disabled}
          onChange={sessionTarget.onChange}
          actions={headerActions}
          className={headerBlockClassName}
          ariaHidden={isHeaderCollapsed}
        />
        {headerToggle}
      </>
    )
  }

  return (
    <>
      <SenderSessionTargetBar
        draft={{ type: 'default' }}
        locked
        disabled
        onChange={() => undefined}
        actions={headerActions}
        actionsOnly
        className={headerBlockClassName}
        ariaHidden={isHeaderCollapsed}
      />
      {headerToggle}
    </>
  )
}
