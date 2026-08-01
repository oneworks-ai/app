import './ImportedSessionDivider.scss'

import { useTranslation } from 'react-i18next'

import { getImportedSessionSummary } from '#~/utils/session-history-import'
import type { Session } from '@oneworks/core'

export const formatImportedSessionTimestamp = (value: number, language: string) => (
  new Intl.DateTimeFormat(language, {
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(new Date(value))
)

export function ImportedSessionDivider({
  session
}: {
  session: Pick<Session, 'adapter' | 'createdAt' | 'historyImport' | 'id'> | undefined
}) {
  const { i18n, t } = useTranslation()
  const summary = getImportedSessionSummary(session)
  if (summary == null) {
    return null
  }

  const timestamp = formatImportedSessionTimestamp(
    summary.importedAt,
    i18n.resolvedLanguage ?? i18n.language
  )
  const label = t('chat.historyImport.dividerLabel', {
    source: summary.sourceLabel,
    time: timestamp
  })

  return (
    <div className='imported-session-divider' role='note' aria-label={label}>
      <span className='imported-session-divider__line' aria-hidden='true' />
      <span className='imported-session-divider__label'>{label}</span>
      <span className='imported-session-divider__line' aria-hidden='true' />
    </div>
  )
}
