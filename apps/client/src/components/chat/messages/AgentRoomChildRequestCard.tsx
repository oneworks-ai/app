import { useTranslation } from 'react-i18next'

import { MarkdownContent } from '#~/components/MarkdownContent'

import type { AgentRoomChildRequest } from './agent-room-child-request'

const PRIMARY_CONTEXT_KEYS = new Set(['childSessionId', 'interactionId', 'runtimeRequestKind'])

export function AgentRoomChildRequestCard({
  request
}: {
  request: AgentRoomChildRequest
}) {
  const { t } = useTranslation()
  const primaryContext = request.context.filter(item => PRIMARY_CONTEXT_KEYS.has(item.key))
  const secondaryContext = request.context.filter(item => !PRIMARY_CONTEXT_KEYS.has(item.key))
  const targetLabel = [request.memberLabel, request.runTitle].filter(Boolean).join(' / ')

  return (
    <section className='agent-room-child-request-card'>
      <div className='agent-room-child-request-card__header'>
        <span className='material-symbols-rounded agent-room-child-request-card__icon' aria-hidden='true'>
          assignment_late
        </span>
        <div className='agent-room-child-request-card__title-block'>
          <div className='agent-room-child-request-card__title'>
            {t('chat.agentRoomChildRequest.title')}
          </div>
          {targetLabel !== '' && (
            <div className='agent-room-child-request-card__target'>
              {targetLabel}
            </div>
          )}
        </div>
      </div>

      <div className='agent-room-child-request-card__request'>
        <div className='agent-room-child-request-card__label'>
          {t('chat.agentRoomChildRequest.request')}
        </div>
        <MarkdownContent content={request.request} />
      </div>

      {request.options.length > 0 && (
        <div className='agent-room-child-request-card__section'>
          <div className='agent-room-child-request-card__label'>
            {t('chat.agentRoomChildRequest.options')}
          </div>
          <div className='agent-room-child-request-card__options'>
            {request.options.map(option => (
              <div
                key={`${option.label}:${option.value ?? ''}:${option.description ?? ''}`}
                className='agent-room-child-request-card__option'
              >
                <span className='agent-room-child-request-card__option-label'>{option.label}</span>
                {option.value != null && (
                  <code>{option.value}</code>
                )}
                {option.description != null && (
                  <span className='agent-room-child-request-card__option-description'>{option.description}</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {primaryContext.length > 0 && (
        <dl className='agent-room-child-request-card__context'>
          {primaryContext.map(item => (
            <div key={item.key} className='agent-room-child-request-card__context-row'>
              <dt>{item.key}</dt>
              <dd>{item.value}</dd>
            </div>
          ))}
        </dl>
      )}

      {secondaryContext.length > 0 && (
        <details className='agent-room-child-request-card__details'>
          <summary>{t('chat.agentRoomChildRequest.moreContext')}</summary>
          <dl className='agent-room-child-request-card__context agent-room-child-request-card__context--secondary'>
            {secondaryContext.map(item => (
              <div key={item.key} className='agent-room-child-request-card__context-row'>
                <dt>{item.key}</dt>
                <dd>{item.value}</dd>
              </div>
            ))}
          </dl>
        </details>
      )}
    </section>
  )
}
