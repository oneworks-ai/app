import type { JavaScriptErrorReport } from '@oneworks/diagnostics'

import { fetchApiJson, jsonHeaders } from './base'

export const postJavaScriptErrorReport = async (report: JavaScriptErrorReport) => {
  await fetchApiJson<{ accepted: boolean }>('/api/diagnostics/javascript-errors', {
    body: JSON.stringify(report),
    headers: jsonHeaders,
    method: 'POST',
    timeoutMs: 3_000
  })
}
