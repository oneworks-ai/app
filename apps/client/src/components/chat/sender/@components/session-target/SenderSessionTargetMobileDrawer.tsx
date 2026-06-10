/* eslint-disable max-lines -- session target mobile selector keeps breadcrumb navigation and resource rows together. */
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type {
  ChatSessionTargetDraft,
  ChatSessionTargetResource,
  ChatSessionTargetType
} from '#~/hooks/chat/chat-session-target'

import {
  SenderMobileSelectBreadcrumbs,
  SenderMobileSelectDrawer,
  handleSenderMobileSelectOptionKeyDown
} from '../mobile-select-drawer/SenderMobileSelectDrawer'
import { selectableSessionTargetTypes, sessionTargetModeIcons } from './session-target-constants'
import type { SelectableTargetType } from './session-target-constants'

type SessionTargetMobileView =
  | { kind: 'root' }
  | { kind: 'type'; type: SelectableTargetType }

export function SenderSessionTargetMobileDrawer({
  open,
  draft,
  resourcesByType,
  onClose,
  onSelect
}: {
  open: boolean
  draft: ChatSessionTargetDraft
  resourcesByType: Record<SelectableTargetType, ChatSessionTargetResource[]>
  onClose: () => void
  onSelect: (type: ChatSessionTargetType, resource?: ChatSessionTargetResource) => void
}) {
  const { t } = useTranslation()
  const [targetView, setTargetView] = useState<SessionTargetMobileView>({ kind: 'root' })
  const activeType = draft.type
  const activeViewType = targetView.kind === 'type' ? targetView.type : undefined
  const activeViewResources = activeViewType == null ? [] : resourcesByType[activeViewType]

  const isResourceSelected = (type: SelectableTargetType, resource: ChatSessionTargetResource) => {
    if (activeType !== type) {
      return false
    }

    return draft.name === (type === 'workspace' ? resource.id : resource.name)
  }

  useEffect(() => {
    if (!open) {
      setTargetView({ kind: 'root' })
    }
  }, [open])

  const breadcrumbs = useMemo(() => {
    const items = [{
      key: 'root',
      label: t('chat.sessionTarget.title'),
      onClick: targetView.kind === 'root' ? undefined : () => setTargetView({ kind: 'root' })
    }]

    if (activeViewType != null) {
      items.push({
        key: activeViewType,
        label: t(`chat.sessionTarget.modes.${activeViewType}`),
        onClick: undefined
      })
    }

    return items
  }, [activeViewType, targetView.kind, t])

  const renderDefaultOption = () => (
    <div
      role='option'
      tabIndex={0}
      aria-selected={activeType === 'default'}
      className={[
        'sender-mobile-select-option',
        'sender-session-target-mobile-option',
        activeType === 'default' ? 'is-selected' : ''
      ].filter(Boolean).join(' ')}
      onClick={() => onSelect('default')}
      onKeyDown={(event) => handleSenderMobileSelectOptionKeyDown(event, () => onSelect('default'))}
    >
      <span className='material-symbols-rounded sender-mobile-select-option__icon'>
        {sessionTargetModeIcons.default}
      </span>
      <span className='sender-mobile-select-option__copy'>
        <span className='sender-mobile-select-option__title'>
          {t('chat.sessionTarget.modes.default')}
        </span>
      </span>
      {activeType === 'default' && (
        <span className='material-symbols-rounded sender-mobile-select-option__check'>check</span>
      )}
    </div>
  )

  const renderTypeNavigationOption = (type: SelectableTargetType) => {
    const isTypeActive = activeType === type
    const selectedDescription = isTypeActive ? draft.label ?? draft.name : undefined
    const resourceDescription = resourcesByType[type].length === 0
      ? t(`chat.sessionTarget.empty.${type}`)
      : selectedDescription

    return (
      <div
        role='button'
        tabIndex={0}
        key={type}
        className={[
          'sender-mobile-select-option',
          'sender-session-target-mobile-option',
          isTypeActive ? 'is-selected' : ''
        ].filter(Boolean).join(' ')}
        onClick={() => setTargetView({ kind: 'type', type })}
        onKeyDown={(event) => handleSenderMobileSelectOptionKeyDown(event, () => setTargetView({ kind: 'type', type }))}
      >
        <span className='material-symbols-rounded sender-mobile-select-option__icon'>
          {sessionTargetModeIcons[type]}
        </span>
        <span className='sender-mobile-select-option__copy'>
          <span className='sender-mobile-select-option__title'>
            {t(`chat.sessionTarget.modes.${type}`)}
          </span>
          {resourceDescription != null && resourceDescription !== '' && (
            <span className='sender-mobile-select-option__description'>
              {resourceDescription}
            </span>
          )}
        </span>
        <span className='material-symbols-rounded sender-mobile-select-option__chevron'>
          chevron_right
        </span>
      </div>
    )
  }

  const renderResourceOption = (
    type: SelectableTargetType,
    resource: ChatSessionTargetResource
  ) => {
    const isSelected = isResourceSelected(type, resource)

    return (
      <div
        key={`${type}:${type === 'workspace' ? resource.id : resource.name}`}
        role='option'
        tabIndex={0}
        aria-selected={isSelected}
        className={[
          'sender-mobile-select-option',
          'sender-session-target-mobile-option',
          isSelected ? 'is-selected' : ''
        ].filter(Boolean).join(' ')}
        onClick={() => onSelect(type, resource)}
        onKeyDown={(event) => handleSenderMobileSelectOptionKeyDown(event, () => onSelect(type, resource))}
      >
        <span className='material-symbols-rounded sender-mobile-select-option__icon'>
          {sessionTargetModeIcons[type]}
        </span>
        <span className='sender-mobile-select-option__copy'>
          <span className='sender-mobile-select-option__title'>{resource.name}</span>
          {(resource.description ?? resource.path) != null && (
            <span className='sender-mobile-select-option__description'>
              {resource.description ?? resource.path}
            </span>
          )}
        </span>
        {isSelected && (
          <span className='material-symbols-rounded sender-mobile-select-option__check'>check</span>
        )}
      </div>
    )
  }

  const renderTargetList = () => {
    if (activeViewType != null) {
      return activeViewResources.length > 0
        ? activeViewResources.map(resource => renderResourceOption(activeViewType, resource))
        : (
          <div className='sender-mobile-select-option is-disabled'>
            <span className='material-symbols-rounded sender-mobile-select-option__icon'>
              {sessionTargetModeIcons[activeViewType]}
            </span>
            <span className='sender-mobile-select-option__title'>
              {t(`chat.sessionTarget.empty.${activeViewType}`)}
            </span>
          </div>
        )
    }

    return (
      <>
        {renderDefaultOption()}
        {selectableSessionTargetTypes.map(renderTypeNavigationOption)}
      </>
    )
  }

  return (
    <SenderMobileSelectDrawer
      open={open}
      title={t('chat.sessionTarget.title')}
      className='sender-session-target-mobile-drawer'
      onClose={onClose}
    >
      <SenderMobileSelectBreadcrumbs items={breadcrumbs} />
      <div className='sender-mobile-select-list'>
        {renderTargetList()}
      </div>
    </SenderMobileSelectDrawer>
  )
}
