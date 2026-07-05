/* eslint-disable max-lines -- session target selector keeps desktop submenu and compact drawer coordination together. */
import './SenderSessionTargetBar.scss'

import { Dropdown } from 'antd'
import type { MenuProps } from 'antd'
import type { ReactNode } from 'react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import useSWR from 'swr'

import type { EntitySummary, SpecSummary, WorkspaceSummary } from '#~/api.js'
import { fetchApiJson } from '#~/api/base.js'
import { DEFAULT_CHAT_SESSION_TARGET_DRAFT, createChatSessionTargetDraft } from '#~/hooks/chat/chat-session-target'
import type {
  ChatSessionTargetDraft,
  ChatSessionTargetResource,
  ChatSessionTargetType
} from '#~/hooks/chat/chat-session-target'
import { useResponsiveLayout } from '#~/hooks/use-responsive-layout'

import { SenderSessionTargetMobileDrawer } from './SenderSessionTargetMobileDrawer'
import { SenderSessionTargetTrigger } from './SenderSessionTargetTrigger'
import {
  selectableSessionTargetTypes,
  sessionTargetMenuKeySeparator,
  sessionTargetModeIcons
} from './session-target-constants'
import type { SelectableTargetType } from './session-target-constants'

const toResource = (item: WorkspaceSummary | EntitySummary | SpecSummary): ChatSessionTargetResource => ({
  id: item.id,
  name: item.name,
  description: item.description,
  path: 'path' in item ? item.path : item.id
})

const sessionTargetResourceSWRConfig = {
  dedupingInterval: 5 * 60_000,
  refreshWhenHidden: false,
  revalidateOnFocus: false
} as const

const fetchSessionTargetResource = async <T,>(path: string) => fetchApiJson<T>(path)

export function SenderSessionTargetBar({
  draft,
  locked,
  disabled,
  onChange,
  actions,
  actionsOnly = false,
  className,
  ariaHidden
}: {
  draft: ChatSessionTargetDraft
  locked: boolean
  disabled?: boolean
  onChange: (target: ChatSessionTargetDraft) => void
  actions?: ReactNode
  actionsOnly?: boolean
  className?: string
  ariaHidden?: boolean
}) {
  const { t } = useTranslation()
  const { isCompactLayout, isTouchInteraction } = useResponsiveLayout()
  const [showTargetSelect, setShowTargetSelect] = useState(false)
  const activeType = draft.type
  const isControlDisabled = locked || disabled === true
  const isCompactControl = isCompactLayout || isTouchInteraction
  const shouldLoadSessionTargetResources = showTargetSelect && !isControlDisabled
  const { data: specsRes } = useSWR<{ specs: SpecSummary[] }>(
    shouldLoadSessionTargetResources ? '/api/ai/specs' : null,
    fetchSessionTargetResource,
    sessionTargetResourceSWRConfig
  )
  const { data: entitiesRes } = useSWR<{ entities: EntitySummary[] }>(
    shouldLoadSessionTargetResources ? '/api/ai/entities' : null,
    fetchSessionTargetResource,
    sessionTargetResourceSWRConfig
  )
  const { data: workspacesRes } = useSWR<{ workspaces: WorkspaceSummary[] }>(
    shouldLoadSessionTargetResources ? '/api/ai/workspaces' : null,
    fetchSessionTargetResource,
    sessionTargetResourceSWRConfig
  )

  const resourcesByType = useMemo<Record<SelectableTargetType, ChatSessionTargetResource[]>>(() => ({
    workspace: (workspacesRes?.workspaces ?? []).map(toResource),
    entity: (entitiesRes?.entities ?? []).map(toResource),
    spec: (specsRes?.specs ?? []).map(toResource)
  }), [entitiesRes?.entities, specsRes?.specs, workspacesRes?.workspaces])

  const selectedLabel = draft.label ?? draft.name
  const selectedText = activeType === 'default'
    ? null
    : selectedLabel ?? t(`chat.sessionTarget.placeholders.${activeType}`)

  const handleSelect = (type: ChatSessionTargetType, resource?: ChatSessionTargetResource) => {
    if (isControlDisabled) return

    setShowTargetSelect(false)
    if (type === 'default') {
      onChange({ ...DEFAULT_CHAT_SESSION_TARGET_DRAFT })
      return
    }

    onChange(
      resource == null
        ? { type }
        : createChatSessionTargetDraft(type, resource)
    )
  }

  const menuItems = useMemo<MenuProps['items']>(() => [
    {
      key: 'default',
      label: t('chat.sessionTarget.modes.default'),
      icon: (
        <span className='material-symbols-rounded sender-session-target__menu-icon'>
          {sessionTargetModeIcons.default}
        </span>
      )
    },
    { type: 'divider' },
    ...selectableSessionTargetTypes.map(type => ({
      key: type,
      label: t(`chat.sessionTarget.modes.${type}`),
      icon: (
        <span className='material-symbols-rounded sender-session-target__menu-icon'>
          {sessionTargetModeIcons[type]}
        </span>
      ),
      popupClassName: 'sender-session-target__submenu-popup',
      children: resourcesByType[type].length > 0
        ? resourcesByType[type].map(resource => ({
          key: `${type}${sessionTargetMenuKeySeparator}${type === 'workspace' ? resource.id : resource.name}`,
          label: (
            <span className='sender-session-target__menu-item'>
              <span className='sender-session-target__menu-item-name'>{resource.name}</span>
              {(resource.description ?? resource.path) != null && (
                <span className='sender-session-target__menu-item-desc'>{resource.description ?? resource.path}</span>
              )}
            </span>
          )
        }))
        : [{
          key: `${type}${sessionTargetMenuKeySeparator}__empty`,
          label: t(`chat.sessionTarget.empty.${type}`),
          disabled: true
        }]
    }))
  ], [resourcesByType, t])

  const handleMenuClick: MenuProps['onClick'] = ({ key }) => {
    const rawKey = String(key)
    if (rawKey === 'default') {
      handleSelect('default')
      return
    }

    const [type, resourceValue] = rawKey.split(sessionTargetMenuKeySeparator) as [
      SelectableTargetType | undefined,
      string?
    ]
    if (
      type == null ||
      !selectableSessionTargetTypes.includes(type) ||
      resourceValue == null ||
      resourceValue === '__empty'
    ) {
      return
    }

    const resource = resourcesByType[type].find(item => (type === 'workspace' ? item.id : item.name) === resourceValue)
    handleSelect(type, resource)
  }

  const openTargetSelect = () => {
    if (!isControlDisabled) {
      setShowTargetSelect(true)
    }
  }

  const closeTargetSelect = () => setShowTargetSelect(false)

  const triggerButton = (
    <SenderSessionTargetTrigger
      activeType={activeType}
      selectedText={selectedText}
      disabled={isControlDisabled}
      onClick={isCompactControl ? openTargetSelect : undefined}
    />
  )

  return (
    <div
      className={[
        'sender-session-target',
        locked ? 'is-locked' : '',
        actionsOnly ? 'sender-session-target--actions-only' : '',
        className ?? ''
      ].filter(Boolean).join(' ')}
      aria-hidden={ariaHidden}
    >
      <div
        className={[
          'sender-session-target__controls',
          actionsOnly ? 'sender-session-target__controls--actions-only' : ''
        ].filter(Boolean).join(' ')}
      >
        {!actionsOnly && (
          isCompactControl
            ? (
              <>
                {triggerButton}
                <SenderSessionTargetMobileDrawer
                  open={showTargetSelect}
                  draft={draft}
                  resourcesByType={resourcesByType}
                  onClose={closeTargetSelect}
                  onSelect={handleSelect}
                />
              </>
            )
            : (
              <Dropdown
                menu={{
                  items: menuItems,
                  onClick: handleMenuClick,
                  className: 'sender-session-target__dropdown-menu',
                  expandIcon: (
                    <span className='material-symbols-rounded sender-session-target__submenu-chevron'>
                      chevron_right
                    </span>
                  )
                }}
                trigger={['click']}
                placement='topLeft'
                onOpenChange={setShowTargetSelect}
                overlayClassName='sender-session-target__dropdown'
                disabled={isControlDisabled}
              >
                {triggerButton}
              </Dropdown>
            )
        )}
        {actions != null && (
          <div className='sender-session-target__actions'>
            {actions}
          </div>
        )}
      </div>
    </div>
  )
}
