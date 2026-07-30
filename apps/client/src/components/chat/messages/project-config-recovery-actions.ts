export type ProjectConfigRecoveryPendingAction = 'confirm' | 'open' | 'retry'

export interface ProjectConfigRecoveryResult {
  queued?: boolean
  reason?: 'already_queued'
}

export interface ProjectConfigRecoveryConfirmation {
  onCancel: () => void
  onOk: () => Promise<void>
}

export const createScopedProjectConfigRecoveryActions = (params: {
  confirm: (confirmation: ProjectConfigRecoveryConfirmation) => void
  focus: (action: 'open' | 'retry') => void
  getCurrentScope: () => string
  getPending: () => ProjectConfigRecoveryPendingAction | null
  onError: (action: 'open' | 'retry', error: unknown) => void
  onSuccess: (result: ProjectConfigRecoveryResult) => void
  open: (sessionId: string) => Promise<unknown>
  retry: (sessionId: string) => Promise<ProjectConfigRecoveryResult>
  scope: string
  sessionId: string
  setPending: (pending: ProjectConfigRecoveryPendingAction | null) => void
}) => {
  const isCurrent = () => params.getCurrentScope() === params.scope
  const begin = (action: ProjectConfigRecoveryPendingAction) => {
    if (!isCurrent() || params.getPending() != null) return false
    params.setPending(action)
    return true
  }
  const finish = (focus: 'open' | 'retry') => {
    if (!isCurrent()) return
    params.setPending(null)
    params.focus(focus)
  }

  return {
    open: async () => {
      if (!begin('open')) return
      try {
        await params.open(params.sessionId)
      } catch (error) {
        if (isCurrent()) params.onError('open', error)
      } finally {
        finish('open')
      }
    },
    requestRetry: () => {
      if (!begin('confirm')) return
      params.confirm({
        onCancel: () => {
          if (params.getPending() === 'retry') return
          finish('retry')
        },
        onOk: async () => {
          if (!isCurrent() || params.getPending() === 'retry') return
          params.setPending('retry')
          try {
            const result = await params.retry(params.sessionId)
            if (isCurrent()) params.onSuccess(result)
          } catch (error) {
            if (isCurrent()) {
              params.onError('retry', error)
            }
          } finally {
            finish('retry')
          }
        }
      })
    }
  }
}
