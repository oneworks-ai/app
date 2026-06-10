import type { IncomingMessage, ServerResponse } from 'node:http'

import { requireAuthPermission } from '../auth/permissions.js'
import { sendJson } from '../http.js'
import { relayPermissions } from '../permissions/index.js'
import type { RelayTelemetry } from '../telemetry/metrics.js'
import type { RelayServerArgs, RelayStore } from '../types.js'

const methodNotAllowed = (res: ServerResponse, args: RelayServerArgs) => {
  sendJson(res, 405, { error: 'Method not allowed.' }, args.allowOrigin)
}

export const handleRelayMetrics = (
  req: IncomingMessage,
  res: ServerResponse,
  args: RelayServerArgs,
  store: RelayStore,
  telemetry: RelayTelemetry
) => {
  if (req.method !== 'GET') {
    methodNotAllowed(res, args)
    return
  }
  if (
    requireAuthPermission(req, res, args, store, relayPermissions.adminSettingsRead, {
      unauthorizedError: 'Admin token required.'
    }) == null
  ) {
    return
  }
  sendJson(res, 200, telemetry.metrics.snapshot(), args.allowOrigin)
}
