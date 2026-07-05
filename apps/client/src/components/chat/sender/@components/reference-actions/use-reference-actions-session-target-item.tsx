import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import useSWR from 'swr'

import type { EntitySummary, SpecSummary, WorkspaceSummary } from '#~/api.js'
import { fetchApiJson } from '#~/api/base.js'
import type { OverlayMenuItem } from '#~/components/overlay'
import { DEFAULT_CHAT_SESSION_TARGET_DRAFT, createChatSessionTargetDraft } from '#~/hooks/chat/chat-session-target'
import type { ChatSessionTargetResource, ChatSessionTargetType } from '#~/hooks/chat/chat-session-target'

import type { SenderProps } from '../../@types/sender-props'
import { selectableSessionTargetTypes, sessionTargetModeIcons } from '../session-target/session-target-constants'
import type { SelectableTargetType } from '../session-target/session-target-constants'

const toResource = (item: WorkspaceSummary | EntitySummary | SpecSummary): ChatSessionTargetResource => ({
  id: item.id,
  name: item.name,
  description: item.description,
  path: 'path' in item ? item.path : item.id
})

const resourceKey = (type: SelectableTargetType, resource: ChatSessionTargetResource) =>
  `session-target:${type}:${type === 'workspace' ? resource.id : resource.name}`

const sessionTargetResourceSWRConfig = {
  dedupingInterval: 5 * 60_000,
  refreshWhenHidden: false,
  revalidateOnFocus: false
} as const

const fetchSessionTargetResource = async <T,>(path: string) => fetchApiJson<T>(path)

export function useReferenceActionsSessionTargetItem({
  sessionTarget,
  showSessionTargetInMore
}: {
  sessionTarget?: SenderProps['sessionTarget']
  showSessionTargetInMore: boolean
}): OverlayMenuItem | null {
  const { t } = useTranslation()
  const { data: specsRes } = useSWR<{ specs: SpecSummary[] }>(
    showSessionTargetInMore ? '/api/ai/specs' : null,
    fetchSessionTargetResource,
    sessionTargetResourceSWRConfig
  )
  const { data: entitiesRes } = useSWR<{ entities: EntitySummary[] }>(
    showSessionTargetInMore ? '/api/ai/entities' : null,
    fetchSessionTargetResource,
    sessionTargetResourceSWRConfig
  )
  const { data: workspacesRes } = useSWR<{ workspaces: WorkspaceSummary[] }>(
    showSessionTargetInMore ? '/api/ai/workspaces' : null,
    fetchSessionTargetResource,
    sessionTargetResourceSWRConfig
  )

  return useMemo(() => {
    if (sessionTarget == null || !showSessionTargetInMore) return null

    const draft = sessionTarget.draft
    const resourcesByType: Record<SelectableTargetType, ChatSessionTargetResource[]> = {
      workspace: (workspacesRes?.workspaces ?? []).map(toResource),
      entity: (entitiesRes?.entities ?? []).map(toResource),
      spec: (specsRes?.specs ?? []).map(toResource)
    }
    const selectTarget = (type: ChatSessionTargetType, resource?: ChatSessionTargetResource) => {
      if (sessionTarget.locked || sessionTarget.disabled === true) return
      if (type === 'default') {
        sessionTarget.onChange({ ...DEFAULT_CHAT_SESSION_TARGET_DRAFT })
        return
      }
      if (resource != null) {
        sessionTarget.onChange(createChatSessionTargetDraft(type, resource))
      }
    }
    const selectedText = draft.type === 'default'
      ? t('chat.sessionTarget.modes.default')
      : draft.label ?? draft.name ?? t(`chat.sessionTarget.placeholders.${draft.type}`)

    return {
      key: 'session-target',
      label: t('chat.sessionTarget.title'),
      icon: sessionTargetModeIcons[draft.type],
      trailing: <span className='reference-actions-menu-current'>{selectedText}</span>,
      children: [
        {
          key: 'session-target:default',
          label: t('chat.sessionTarget.modes.default'),
          icon: sessionTargetModeIcons.default,
          selected: draft.type === 'default',
          onSelect: () => selectTarget('default')
        },
        { key: 'session-target:divider', type: 'divider' },
        ...selectableSessionTargetTypes.map(type => ({
          key: `session-target:${type}`,
          label: t(`chat.sessionTarget.modes.${type}`),
          icon: sessionTargetModeIcons[type],
          selected: draft.type === type,
          children: resourcesByType[type].length > 0
            ? resourcesByType[type].map(resource => ({
              key: resourceKey(type, resource),
              label: resource.name,
              description: resource.description ?? resource.path,
              selected: draft.type === type && draft.name === (type === 'workspace' ? resource.id : resource.name),
              onSelect: () => selectTarget(type, resource)
            }))
            : [{
              key: `session-target:${type}:empty`,
              label: t(`chat.sessionTarget.empty.${type}`),
              disabled: true
            }]
        }))
      ]
    }
  }, [
    entitiesRes?.entities,
    sessionTarget,
    showSessionTargetInMore,
    specsRes?.specs,
    t,
    workspacesRes?.workspaces
  ])
}
