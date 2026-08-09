import { afterEach, describe, expect, it, vi } from 'vitest'

import type { JavaScriptErrorReport } from '@oneworks/diagnostics'

import {
  installGlobalJavaScriptErrorReporting,
  reportClientJavaScriptError
} from '../src/diagnostics/javascript-error-reporting'

describe('client JavaScript error reporting', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  const installWindow = (reportJavaScriptError: (report: JavaScriptErrorReport) => Promise<void>) => {
    const target = new EventTarget() as EventTarget & {
      oneworksDesktop: { reportJavaScriptError: typeof reportJavaScriptError }
    }
    target.oneworksDesktop = { reportJavaScriptError }
    vi.stubGlobal('window', target)
    return target
  }

  it('uses the Electron bridge and sends only a privacy-safe report', async () => {
    const reportJavaScriptError = vi.fn(async (_report: JavaScriptErrorReport) => {})
    installWindow(reportJavaScriptError)
    const error = new Error('secret prompt')
    error.stack = 'Error: secret prompt\n    at render (/Users/private/App.tsx:1:2)'

    reportClientJavaScriptError(error, 'client.react_render')
    await vi.waitFor(() => expect(reportJavaScriptError).toHaveBeenCalledOnce())

    const report = reportJavaScriptError.mock.calls[0]?.[0]
    expect(report).toMatchObject({
      source: 'client.react_render',
      surface: 'desktop',
      type: 'Error'
    })
    expect(JSON.stringify(report)).not.toContain('secret prompt')
    expect(JSON.stringify(report)).not.toContain('/Users/private')
  })

  it('captures global errors and unhandled rejections', async () => {
    const reportJavaScriptError = vi.fn(async (_report: JavaScriptErrorReport) => {})
    const target = installWindow(reportJavaScriptError)
    const uninstall = installGlobalJavaScriptErrorReporting()

    const errorEvent = new Event('error')
    Object.defineProperty(errorEvent, 'error', { value: new TypeError('private') })
    target.dispatchEvent(errorEvent)
    const rejectionEvent = new Event('unhandledrejection')
    Object.defineProperty(rejectionEvent, 'reason', { value: new Error('private rejection') })
    target.dispatchEvent(rejectionEvent)

    await vi.waitFor(() => expect(reportJavaScriptError).toHaveBeenCalledTimes(2))
    expect(reportJavaScriptError.mock.calls.map(call => call[0]!.source)).toEqual([
      'client.window_error',
      'client.unhandled_rejection'
    ])
    uninstall()
  })
})
