import type { ChatErrorState } from '#~/hooks/chat/interaction-state'
import type { SessionCompactionInfo, SessionCompactionStatus } from '#~/hooks/chat/session-compaction'

type Translate = (key: string, options?: Record<string, unknown>) => string

export interface ChatHistoryStatusNotice {
  action?: 'retry-connection' | 'retry-session-creation'
  detail?: string
  icon: string
  id: string
  message: string
  meta?: string
  tone: 'error' | 'info' | 'warning'
  title: string
}

const createModelUnavailableNotice = (t: Translate): ChatHistoryStatusNotice => ({
  icon: 'settings_suggest',
  id: 'model-unavailable',
  message: t('chat.modelConfigRequired'),
  detail: t('chat.modelConfigRequiredHelp'),
  tone: 'warning',
  title: t('chat.modelConfigRequiredTitle')
})

const createConnectionNotice = (
  t: Translate,
  state: ChatErrorState
): ChatHistoryStatusNotice => {
  const isClosed = state.reason === 'closed'
  const isAuthFailure = state.code === 'auth_required'

  return {
    action: state.recoverable === false ? undefined : 'retry-connection',
    detail: isAuthFailure
      ? t('chat.connectionAuthRequiredHelp')
      : isClosed
      ? t('chat.connectionClosedHelp')
      : t('chat.connectionErrorHelp'),
    icon: isAuthFailure ? 'lock' : isClosed ? 'wifi_off' : 'cloud_off',
    id: isClosed
      ? 'connection-closed'
      : 'connection-error',
    message: state.message,
    tone: 'error',
    title: isAuthFailure
      ? t('chat.connectionAuthRequiredTitle')
      : isClosed
      ? t('chat.connectionClosedTitle')
      : t('chat.connectionErrorTitle')
  }
}

const createSessionNotice = (
  t: Translate,
  state: ChatErrorState
): ChatHistoryStatusNotice => {
  const isCreateFailure = state.action === 'retry-session-creation'

  return {
    ...(state.action == null ? {} : { action: state.action }),
    detail: isCreateFailure ? t('chat.sessionCreateFailedHelp') : t('chat.sessionErrorHelp'),
    icon: 'error',
    id: isCreateFailure ? 'session-create-failed' : 'session-error',
    message: state.message,
    ...(!isCreateFailure && state.code != null && state.code !== ''
      ? { meta: t('chat.sessionErrorCode', { code: state.code }) }
      : {}),
    tone: 'error',
    title: isCreateFailure ? t('chat.sessionCreateFailedTitle') : t('chat.sessionErrorTitle')
  }
}

const getSessionCompactionTitleKey = (status: SessionCompactionStatus) => (
  status === 'compressing' ? 'chat.contextCompressingTitle' : 'chat.contextCompactedTitle'
)

export const createSessionCompactionNotice = (
  t: Translate,
  info: SessionCompactionInfo
): ChatHistoryStatusNotice => ({
  icon: 'layers',
  id: `context-compaction:${info.id}`,
  message: '',
  tone: 'info',
  title: t(getSessionCompactionTitleKey(info.status))
})

export const buildChatHistoryStatusNotices = ({
  errorState,
  modelUnavailable,
  t
}: {
  errorState?: ChatErrorState | null
  modelUnavailable: boolean
  t: Translate
}) => {
  const notices: ChatHistoryStatusNotice[] = []

  if (modelUnavailable) {
    notices.push(createModelUnavailableNotice(t))
  }

  if (errorState != null && errorState.message.trim() !== '') {
    if (errorState.kind === 'session') {
      notices.push(createSessionNotice(t, errorState))
    } else {
      notices.push(createConnectionNotice(t, errorState))
    }
  }

  return notices
}
