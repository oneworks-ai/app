import type { ChatSessionOperationInfo } from './session-view-cache'

const ADAPTER_CLI_PREPARE_OPERATION_ID = 'adapter-cli-prepare'

export const getSessionActivityLabel = (
  sessionOperationInfo: ChatSessionOperationInfo | null,
  t: (key: string) => string
) => {
  if (sessionOperationInfo == null) {
    return undefined
  }

  if (sessionOperationInfo.operationId === ADAPTER_CLI_PREPARE_OPERATION_ID) {
    return t('chat.sessionOperation.adapterCliPrepare')
  }

  return sessionOperationInfo.message ??
    sessionOperationInfo.title ??
    sessionOperationInfo.summary ??
    t('chat.thinking')
}
