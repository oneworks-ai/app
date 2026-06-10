import { RELOAD_WINDOW_SHORTCUT_LABEL } from './constants'
import type { WindowRecord } from './types'

const WINDOW_LOAD_FAILURE_MARKER = 'oneworks-desktop-load-failure'
const DATA_HTML_URL_PREFIX = 'data:text/html'
const ERR_ABORTED = -3

const escapeInlineHtmlText = (value: unknown) => String(value).replace(/[<>&"]/g, '')

export const isWindowLoadFailureScreenUrl = (url: string) => (
  url.startsWith(DATA_HTML_URL_PREFIX) && url.includes(WINDOW_LOAD_FAILURE_MARKER)
)

export const isLoadUrlAbortError = (error: unknown) => (
  error != null &&
  typeof error === 'object' &&
  ('code' in error || 'errno' in error) &&
  ((error as { code?: unknown }).code === 'ERR_ABORTED' || (error as { errno?: unknown }).errno === ERR_ABORTED)
)

export const shouldShowWindowLoadFailureScreen = (input: {
  errorCode?: number
  isMainFrame?: boolean
  targetUrl: string
}) => (
  input.isMainFrame !== false &&
  input.errorCode !== ERR_ABORTED &&
  input.targetUrl.trim() !== '' &&
  !input.targetUrl.startsWith(DATA_HTML_URL_PREFIX)
)

const buildWindowLoadFailureHtml = (input: {
  errorCode?: number
  errorDescription: string
  targetUrl: string
}) => {
  const errorParts = [
    input.errorDescription,
    input.errorCode == null ? undefined : `Code ${input.errorCode}`
  ].filter((part): part is string => part != null && part.trim() !== '')
  const errorSummary = errorParts.join(' / ')

  return `
    <!doctype html>
    <html>
      <head>
        <meta charset="utf-8" />
        <title>Reload One Works</title>
        <style>
          body {
            align-items: center;
            background: #111827;
            color: #e5e7eb;
            display: flex;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
            height: 100vh;
            justify-content: center;
            margin: 0;
          }
          main {
            max-width: 680px;
            padding: 32px;
          }
          h1 {
            font-size: 26px;
            font-weight: 650;
            margin: 0 0 12px;
          }
          p {
            color: #9ca3af;
            font-size: 14px;
            line-height: 1.6;
            margin: 0 0 10px;
          }
          button {
            background: #e5e7eb;
            border: 0;
            border-radius: 6px;
            color: #111827;
            cursor: pointer;
            font: inherit;
            font-size: 14px;
            font-weight: 650;
            margin: 14px 0 18px;
            padding: 9px 14px;
          }
          code {
            color: #bfdbfe;
            overflow-wrap: anywhere;
          }
          .detail {
            color: #6b7280;
            font-size: 12px;
          }
        </style>
      </head>
      <body data-${WINDOW_LOAD_FAILURE_MARKER}="true">
        <main>
          <h1>One Works could not load this window.</h1>
          <p>Use <strong>View &gt; Reload Window</strong> or press <strong>${
    escapeInlineHtmlText(RELOAD_WINDOW_SHORTCUT_LABEL)
  }</strong> to try again.</p>
          <button type="button">Reload Window</button>
          <p class="detail"><code>${escapeInlineHtmlText(input.targetUrl)}</code></p>
          ${errorSummary === '' ? '' : `<p class="detail">${escapeInlineHtmlText(errorSummary)}</p>`}
        </main>
        <script>
          const targetUrl = ${JSON.stringify(input.targetUrl)};
          document.querySelector('button')?.addEventListener('click', () => {
            window.location.href = targetUrl;
          });
        </script>
      </body>
    </html>
  `
}

export const showWindowLoadFailureScreen = async (
  windowRecord: WindowRecord,
  input: {
    errorCode?: number
    errorDescription?: string
    targetUrl: string
  }
) => {
  if (windowRecord.window.isDestroyed() || isWindowLoadFailureScreenUrl(input.targetUrl)) return
  if (windowRecord.loadFailureUrl === input.targetUrl && windowRecord.loadFailureScreenPending === true) return

  windowRecord.loadFailureUrl = input.targetUrl
  windowRecord.loadFailureScreenPending = true
  try {
    await windowRecord.window.loadURL(
      `data:text/html;charset=utf-8,${
        encodeURIComponent(buildWindowLoadFailureHtml({
          errorCode: input.errorCode,
          errorDescription: input.errorDescription ?? 'The page did not finish loading.',
          targetUrl: input.targetUrl
        }))
      }`
    )
  } catch (error) {
    console.warn('[oneworks-desktop] failed to show window load failure screen', error)
  } finally {
    windowRecord.loadFailureScreenPending = false
  }
}

export const installWindowLoadFailureHandlers = (windowRecord: WindowRecord) => {
  const { window } = windowRecord

  window.webContents.on('did-finish-load', () => {
    const currentUrl = window.webContents.getURL()
    if (isWindowLoadFailureScreenUrl(currentUrl)) return

    windowRecord.loadFailureUrl = undefined
    windowRecord.loadFailureScreenPending = false
  })

  window.webContents.on('did-fail-load', (
    _event,
    errorCode,
    errorDescription,
    validatedURL,
    isMainFrame
  ) => {
    if (
      !shouldShowWindowLoadFailureScreen({
        errorCode,
        isMainFrame,
        targetUrl: validatedURL
      }) ||
      window.isDestroyed()
    ) {
      return
    }

    void showWindowLoadFailureScreen(windowRecord, {
      errorCode,
      errorDescription,
      targetUrl: validatedURL
    })
  })

  window.webContents.on('render-process-gone', (_event, details) => {
    if (window.isDestroyed() || details.reason === 'clean-exit') return

    const targetUrl = windowRecord.loadFailureUrl ?? window.webContents.getURL()
    if (targetUrl === '' || !shouldShowWindowLoadFailureScreen({ targetUrl })) return

    void showWindowLoadFailureScreen(windowRecord, {
      errorCode: details.exitCode,
      errorDescription: `Renderer process exited: ${details.reason}`,
      targetUrl
    })
  })
}
