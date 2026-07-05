import type { IncomingMessage, ServerResponse } from 'node:http'

import { sendJson } from '../http.js'
import { decodeSegment } from '../session-forwarding/http.js'
import {
  handleGetJob,
  handleGetJobResult,
  handleListJobs,
  handleSubmitJob,
  handleSubmitWorkspaceRequestJob,
  handleUpdateJobStatus
} from '../session-forwarding/job-handlers.js'
import { handleListSessions, handleSnapshotUpdate } from '../session-forwarding/session-handlers.js'
import type { RelayStoreRepository } from '../storage/repository.js'
import type { RelayTelemetry } from '../telemetry/metrics.js'
import type { RelayServerArgs, RelayStore } from '../types.js'

const methodNotAllowed = (res: ServerResponse, args: RelayServerArgs) => {
  sendJson(res, 405, { error: 'Method not allowed.' }, args.allowOrigin)
}

export const handleRelaySessionsRoute = async (
  req: IncomingMessage,
  res: ServerResponse,
  args: RelayServerArgs,
  store: RelayStore,
  storeRepository: RelayStoreRepository,
  url: URL,
  telemetry?: RelayTelemetry
) => {
  const deviceSessionsMatch = /^\/api\/relay\/devices\/([^/]+)\/sessions$/.exec(url.pathname)
  if (deviceSessionsMatch != null) {
    const deviceId = decodeSegment(deviceSessionsMatch[1])
    if (req.method === 'GET') {
      handleListSessions(req, res, args, store, deviceId)
      return true
    }
    methodNotAllowed(res, args)
    return true
  }

  const snapshotMatch = /^\/api\/relay\/devices\/([^/]+)\/sessions\/snapshot$/.exec(url.pathname)
  if (snapshotMatch != null) {
    if (req.method === 'POST') {
      await handleSnapshotUpdate(req, res, args, store, storeRepository, decodeSegment(snapshotMatch[1]), telemetry)
      return true
    }
    methodNotAllowed(res, args)
    return true
  }

  const submitMatch = /^\/api\/relay\/devices\/([^/]+)\/sessions\/([^/]+)\/messages$/.exec(url.pathname)
  if (submitMatch != null) {
    if (req.method === 'POST') {
      await handleSubmitJob(
        req,
        res,
        args,
        store,
        storeRepository,
        decodeSegment(submitMatch[1]),
        decodeSegment(submitMatch[2]),
        telemetry
      )
      return true
    }
    methodNotAllowed(res, args)
    return true
  }

  const workspaceRequestMatch = /^\/api\/relay\/devices\/([^/]+)\/workspace\/requests$/.exec(url.pathname)
  if (workspaceRequestMatch != null) {
    if (req.method === 'POST') {
      await handleSubmitWorkspaceRequestJob(
        req,
        res,
        args,
        store,
        storeRepository,
        decodeSegment(workspaceRequestMatch[1]),
        telemetry
      )
      return true
    }
    methodNotAllowed(res, args)
    return true
  }

  const deviceJobsMatch = /^\/api\/relay\/devices\/([^/]+)\/session-jobs$/.exec(url.pathname)
  if (deviceJobsMatch != null) {
    if (req.method === 'GET') {
      await handleListJobs(req, res, args, store, storeRepository, url, decodeSegment(deviceJobsMatch[1]), telemetry)
      return true
    }
    methodNotAllowed(res, args)
    return true
  }

  const jobResultMatch = /^\/api\/relay\/session-jobs\/([^/]+)\/result$/.exec(url.pathname)
  if (jobResultMatch != null) {
    if (req.method === 'GET') {
      await handleGetJobResult(req, res, args, store, storeRepository, decodeSegment(jobResultMatch[1]), telemetry)
      return true
    }
    methodNotAllowed(res, args)
    return true
  }

  const jobMatch = /^\/api\/relay\/session-jobs\/([^/]+)$/.exec(url.pathname)
  if (jobMatch != null) {
    if (req.method === 'GET') {
      await handleGetJob(req, res, args, store, storeRepository, decodeSegment(jobMatch[1]), telemetry)
      return true
    }
    methodNotAllowed(res, args)
    return true
  }

  const jobStatusMatch = /^\/api\/relay\/session-jobs\/([^/]+)\/status$/.exec(url.pathname)
  if (jobStatusMatch != null) {
    if (req.method === 'POST') {
      await handleUpdateJobStatus(req, res, args, store, storeRepository, decodeSegment(jobStatusMatch[1]), telemetry)
      return true
    }
    methodNotAllowed(res, args)
    return true
  }

  return false
}
