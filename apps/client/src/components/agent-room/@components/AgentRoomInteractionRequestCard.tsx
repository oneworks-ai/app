import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { getStructuredCommandContent } from '../@core/interaction-request-content'
import type { AgentRoomInteractionRequestView } from '../@types/agent-room-view'

const primaryPermissionOptionValues = new Set(['allow_once', 'allow_session', 'deny_once'])

const getOptionMeta = (value?: string) => {
  switch (value) {
    case 'allow_once':
      return { icon: 'task_alt', tone: 'allow' as const }
    case 'allow_session':
      return { icon: 'history_toggle_off', tone: 'allow' as const }
    case 'allow_project':
      return { icon: 'folder_managed', tone: 'allow' as const }
    case 'deny_once':
      return { icon: 'cancel', tone: 'deny' as const }
    case 'deny_session':
      return { icon: 'block', tone: 'deny' as const }
    case 'deny_project':
      return { icon: 'folder_off', tone: 'deny' as const }
    default:
      return { icon: 'help', tone: 'neutral' as const }
  }
}

const getResponseText = (response: AgentRoomInteractionRequestView['response']) => {
  if (response == null) {
    return undefined
  }

  return Array.isArray(response) ? response.join(', ') : response
}

export function AgentRoomInteractionRequestCard({
  content,
  request,
  onRespondInteraction
}: {
  content: string
  request: AgentRoomInteractionRequestView
  onRespondInteraction?: (interactionId: string, data: string | string[]) => Promise<void> | void
}) {
  const { t } = useTranslation()
  const [submittingValue, setSubmittingValue] = useState<string | null>(null)
  const [showAllPermissionOptions, setShowAllPermissionOptions] = useState(false)
  const isPending = request.status === 'pending'
  const canRespond = isPending && onRespondInteraction != null
  const responseText = getResponseText(request.response)
  const structuredCommand = getStructuredCommandContent(content, request)
  const statusLabel = t(`agentRoom.interactionRequest.status.${request.status}`)
  const title = request.subjectLabel == null
    ? t('agentRoom.interactionRequest.title')
    : t('chat.permissionRequestTitleWithTool', { tool: request.subjectLabel })
  const optionItems = request.options.map((option, index) => ({
    option,
    index,
    meta: getOptionMeta(option.value)
  }))
  const primaryOptionItems = optionItems.filter(({ option }) => primaryPermissionOptionValues.has(option.value ?? ''))
  const secondaryOptionItems = optionItems.filter(({ option }) =>
    !primaryPermissionOptionValues.has(option.value ?? '')
  )
  const shouldGroupPermissionOptions = primaryOptionItems.length > 0 && secondaryOptionItems.length > 0
  const visibleOptionItems = !shouldGroupPermissionOptions || showAllPermissionOptions
    ? optionItems
    : primaryOptionItems

  const handleSelect = async (data: string) => {
    setSubmittingValue(data)
    try {
      await onRespondInteraction?.(request.interactionId, data)
    } finally {
      setSubmittingValue(null)
    }
  }

  return (
    <section className={`agent-room-interaction-request agent-room-interaction-request--${request.status}`}>
      <div className='agent-room-interaction-request__header'>
        <span className='agent-room-interaction-request__icon material-symbols-rounded' aria-hidden='true'>
          admin_panel_settings
        </span>
        <div className='agent-room-interaction-request__title-block'>
          <div className='agent-room-interaction-request__title'>{title}</div>
          <div className='agent-room-interaction-request__meta'>
            <span>{statusLabel}</span>
            <span>{t(`agentRoom.interactionRequest.kind.${request.requestKind}`)}</span>
          </div>
        </div>
      </div>
      {structuredCommand == null
        ? <div className='agent-room-interaction-request__question'>{content}</div>
        : (
          <div className='agent-room-interaction-request__structured-question'>
            <div className='agent-room-interaction-request__question'>
              {t('agentRoom.interactionRequest.command.summary')}
            </div>
            <div className='agent-room-interaction-request__command-panel'>
              <div className='agent-room-interaction-request__command-header'>
                <span>{t('agentRoom.interactionRequest.command.title')}</span>
                {structuredCommand.shell != null && (
                  <span className='agent-room-interaction-request__command-chip'>
                    {t('agentRoom.interactionRequest.command.shell', { shell: structuredCommand.shell })}
                  </span>
                )}
              </div>
              {structuredCommand.args.length > 0 && (
                <div className='agent-room-interaction-request__command-meta'>
                  {t('agentRoom.interactionRequest.command.arguments', {
                    arguments: structuredCommand.args.join(' ')
                  })}
                </div>
              )}
              <div className='agent-room-interaction-request__command-label'>
                {structuredCommand.script == null
                  ? t('agentRoom.interactionRequest.command.fullCommand')
                  : t('agentRoom.interactionRequest.command.script')}
              </div>
              <pre className='agent-room-interaction-request__command-code'>
                <code>{structuredCommand.script ?? structuredCommand.command}</code>
              </pre>
              {structuredCommand.script != null && (
                <details className='agent-room-interaction-request__command-details'>
                  <summary>{t('agentRoom.interactionRequest.command.fullCommand')}</summary>
                  <pre className='agent-room-interaction-request__command-code agent-room-interaction-request__command-code--full'>
                    <code>{structuredCommand.command}</code>
                  </pre>
                </details>
              )}
            </div>
          </div>
        )}
      {isPending && request.options.length > 0 && (
        <div className='agent-room-interaction-request__options' aria-label={t('agentRoom.interactionRequest.options')}>
          {visibleOptionItems.map(({ option, meta }) => {
            const data = option.value ?? option.label
            const isSubmitting = submittingValue === data
            return (
              <button
                key={`${option.label}:${data}`}
                type='button'
                className={`agent-room-interaction-request__option agent-room-interaction-request__option--${meta.tone}`}
                disabled={!canRespond || submittingValue != null}
                title={option.description}
                onClick={() => {
                  void handleSelect(data)
                }}
              >
                <span
                  className='agent-room-interaction-request__option-icon material-symbols-rounded'
                  aria-hidden='true'
                >
                  {meta.icon}
                </span>
                <span className='agent-room-interaction-request__option-copy'>
                  <span className='agent-room-interaction-request__option-label'>{option.label}</span>
                  {option.description != null && option.description !== '' && (
                    <span className='agent-room-interaction-request__option-description'>
                      {option.description}
                    </span>
                  )}
                </span>
                {isSubmitting && (
                  <span className='agent-room-interaction-request__option-spinner' aria-hidden='true' />
                )}
              </button>
            )
          })}
          {shouldGroupPermissionOptions && (
            <button
              type='button'
              className='agent-room-interaction-request__option-toggle'
              onClick={() => setShowAllPermissionOptions(current => !current)}
            >
              <span>
                {showAllPermissionOptions ? t('chat.permissionCollapseOptions') : t('chat.permissionExpandOptions')}
              </span>
              <span
                className='agent-room-interaction-request__option-toggle-icon material-symbols-rounded'
                aria-hidden='true'
              >
                {showAllPermissionOptions ? 'expand_less' : 'expand_more'}
              </span>
            </button>
          )}
        </div>
      )}
      {!isPending && (
        <div className='agent-room-interaction-request__result'>
          {responseText == null || responseText === ''
            ? statusLabel
            : t('agentRoom.interactionRequest.response', { response: responseText })}
        </div>
      )}
    </section>
  )
}
