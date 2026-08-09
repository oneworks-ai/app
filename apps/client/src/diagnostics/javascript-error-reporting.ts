import { createJavaScriptErrorReporter } from '@oneworks/diagnostics'
import type {
  CreateJavaScriptErrorReportInput,
  JavaScriptErrorReport,
  JavaScriptErrorSource
} from '@oneworks/diagnostics'

import { postJavaScriptErrorReport } from '#~/api/diagnostics'
import { getClientVersion } from '#~/client-build-info'
import { getRuntimeEnv } from '#~/runtime-config'

const resolveSurface = (): CreateJavaScriptErrorReportInput['surface'] => {
  if (window.oneworksDesktop?.reportJavaScriptError != null) return 'desktop'
  const mode = getRuntimeEnv().__ONEWORKS_PROJECT_CLIENT_MODE__ ?? import.meta.env.__ONEWORKS_PROJECT_CLIENT_MODE__
  return mode === 'standalone' || mode === 'independent' ? 'pwa' : 'web'
}

const sendReport = async (report: JavaScriptErrorReport) => {
  if (window.oneworksDesktop?.reportJavaScriptError != null) {
    await window.oneworksDesktop.reportJavaScriptError(report)
    return
  }
  await postJavaScriptErrorReport(report)
}

const reporter = createJavaScriptErrorReporter({ send: sendReport })

export const reportClientJavaScriptError = (
  error: unknown,
  source: JavaScriptErrorSource,
  input: Pick<CreateJavaScriptErrorReportInput, 'fingerprintMaterial' | 'type'> = {}
) =>
  reporter.capture(error, {
    ...input,
    serviceVersion: getClientVersion(),
    source,
    surface: resolveSurface()
  })

export const installGlobalJavaScriptErrorReporting = () => {
  const handleError = (event: ErrorEvent) => {
    reportClientJavaScriptError(event.error, 'client.window_error', {
      type: event.error instanceof Error ? undefined : 'ErrorEvent'
    })
  }
  const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
    reportClientJavaScriptError(event.reason, 'client.unhandled_rejection')
  }

  window.addEventListener('error', handleError)
  window.addEventListener('unhandledrejection', handleUnhandledRejection)
  return () => {
    window.removeEventListener('error', handleError)
    window.removeEventListener('unhandledrejection', handleUnhandledRejection)
  }
}
