import Router from '@koa/router'

import { parseJavaScriptErrorReport } from '@oneworks/diagnostics'

import { recordClientJavaScriptError } from '#~/services/javascript-diagnostics.js'
import { badRequest } from '#~/utils/http.js'

export function diagnosticsRouter(): Router {
  const router = new Router()

  router.post('/javascript-errors', async (ctx) => {
    const report = parseJavaScriptErrorReport(ctx.request.body)
    if (report == null) {
      throw badRequest('Invalid JavaScript error report.', undefined, 'invalid_javascript_error_report')
    }

    const result = await recordClientJavaScriptError(report)
    ctx.body = { accepted: result.recordedLocally }
  })

  return router
}
