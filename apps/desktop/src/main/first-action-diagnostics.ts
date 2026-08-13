import type { DiagnosticClient, DiagnosticOperationSnapshot } from '@oneworks/diagnostics'
import type { DesktopFirstActionMilestone } from '@oneworks/types'

interface FirstActionSourceState {
  accepted: boolean
  responseReceived: boolean
  submitted: boolean
  succeeded: boolean
}

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

  return {
    cancel: () => {
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
      if (milestone === 'submit.accepted' && !source.accepted) {
        source.accepted = true
        operation.stage(milestone)
        return
      }
      if (milestone === 'first.response.received' && !source.responseReceived) {
        source.responseReceived = true
        operation.ready(milestone)
        return
      }
      if (milestone === 'first.success' && !source.succeeded) {
        source.succeeded = true
        operation.stage(milestone)
        operation.succeed()
        return
      }
      if (milestone === 'first.failed') {
        operation.stage(milestone)
        operation.fail({
          code: 'app.first_action_failed',
          domain: 'provider',
          retryable: true
        })
        return
      }
      if (milestone === 'first.terminated') {
        operation.stage(milestone)
        operation.cancel({
          code: 'app.first_action_terminated',
          domain: 'process',
          retryable: true
        })
      }
    }
  }
}
