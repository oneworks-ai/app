import type { DiagnosticClient, DiagnosticOperationSnapshot } from '@oneworks/diagnostics'
import type { DesktopFirstActionMilestone } from '@oneworks/types'

interface FirstActionSourceState {
  accepted: boolean
  responseReceived: boolean
  submitted: boolean
  succeeded: boolean
}

export const DESKTOP_FIRST_ACTION_ACK_ABANDONMENT_TIMEOUT_MS = 30_000

export interface DesktopFirstActionDiagnostics {
  cancel: () => void
  getSnapshot: () => DiagnosticOperationSnapshot | undefined
  mark: (milestone: DesktopFirstActionMilestone, sourceId: string) => void
}

export const createDesktopFirstActionDiagnostics = (
  client: Pick<DiagnosticClient, 'startOperation'>
): DesktopFirstActionDiagnostics => {
  let operation: ReturnType<DiagnosticClient['startOperation']> | undefined
  let sourceId: string | undefined
  let source: FirstActionSourceState | undefined
  let abandonmentTimer: ReturnType<typeof setTimeout> | undefined

  const clearAbandonmentTimer = () => {
    if (abandonmentTimer == null) return
    clearTimeout(abandonmentTimer)
    abandonmentTimer = undefined
  }
  const terminate = (code: string, domain: 'network' | 'process') => {
    if (operation?.isTerminal() !== false) return
    clearAbandonmentTimer()
    operation.stage('first.terminated')
    operation.cancel({ code, domain, retryable: true })
  }
  const scheduleAbandonment = () => {
    clearAbandonmentTimer()
    abandonmentTimer = setTimeout(() => {
      abandonmentTimer = undefined
      terminate('app.first_action_ack_abandoned', 'network')
    }, DESKTOP_FIRST_ACTION_ACK_ABANDONMENT_TIMEOUT_MS)
  }

  return {
    cancel: () => {
      clearAbandonmentTimer()
      operation?.cancel({
        code: 'app.quit_before_first_action_success',
        domain: 'process',
        retryable: true
      })
    },
    getSnapshot: () => operation?.getSnapshot(),
    mark: (milestone, nextSourceId) => {
      if (nextSourceId.trim() === '' || operation?.isTerminal() === true) return

      if (milestone === 'first.submit') {
        sourceId ??= nextSourceId
        if (sourceId !== nextSourceId || source?.submitted === true) return

        source = { accepted: false, responseReceived: false, submitted: true, succeeded: false }
        operation = client.startOperation('oneworks.app.first_action')
        operation.stage('first.submit')
        return
      }

      if (sourceId !== nextSourceId || source?.submitted !== true || operation == null) return
      if (milestone === 'submit.uncertain' || milestone === 'submit.retrying') {
        operation.stage(milestone)
        scheduleAbandonment()
        return
      }
      if (milestone === 'submit.observed') {
        clearAbandonmentTimer()
        operation.stage(milestone)
        return
      }
      if (milestone === 'submit.accepted' && !source.accepted) {
        clearAbandonmentTimer()
        source.accepted = true
        operation.stage(milestone)
        return
      }
      if (milestone === 'first.response.received' && !source.responseReceived) {
        clearAbandonmentTimer()
        source.responseReceived = true
        operation.ready(milestone)
        return
      }
      if (milestone === 'first.success' && !source.succeeded) {
        clearAbandonmentTimer()
        source.succeeded = true
        operation.stage(milestone)
        operation.succeed()
        return
      }
      if (milestone === 'first.failed') {
        clearAbandonmentTimer()
        operation.stage(milestone)
        operation.fail({
          code: 'app.first_action_failed',
          domain: 'provider',
          retryable: true
        })
        return
      }
      if (milestone === 'first.terminated') {
        terminate('app.first_action_terminated', 'process')
      }
    }
  }
}
