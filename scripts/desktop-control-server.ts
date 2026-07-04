/* eslint-disable max-lines -- desktop-control server keeps the small protocol router and handlers together. */
import { Buffer } from 'node:buffer'
import http from 'node:http'
import process from 'node:process'

import { getChromeDebugTargets } from './chrome-debug'
import { recordDemoVideoScenario } from './demo-video/recorder'
import { getDemoVideoScenario } from './demo-video/scenarios'
import type {
  DemoVideoCaptureSource,
  DemoVideoColorScheme,
  DemoVideoPageBackground,
  DemoVideoRecordOptions,
  DemoVideoRecordResult,
  DemoVideoSystemWindowCaptureBackend
} from './demo-video/types'
import type { DesktopCdpLaunchInput, DesktopCdpLaunchResult } from './desktop-cdp'
import { runDesktopCdpLaunch } from './desktop-cdp'
import { listRuntimeEvidenceSessions, waitForRuntimeEvidenceReply } from './runtime-evidence'
import type { RuntimeEvidenceWaitResult } from './runtime-evidence'

const PROTOCOL_NAME = 'oneworks.desktop-control'
const PROTOCOL_VERSION = 1
const DEFAULT_CONTROL_HOST = '127.0.0.1'
const DEFAULT_CONTROL_PORT = 0
const REQUEST_BODY_LIMIT_BYTES = 1024 * 1024

export interface DesktopControlServeInput {
  host?: string
  json?: boolean
  port?: number
  stdout?: Pick<NodeJS.WriteStream, 'write'>
  text?: boolean
}

export interface DesktopControlSessionRecord {
  createdAt: string
  launch: DesktopCdpLaunchResult
  sessionId: string
}

export interface DesktopControlServerState {
  sessions: Map<string, DesktopControlSessionRecord>
}

export interface DesktopControlServerDeps {
  getTargets: typeof getChromeDebugTargets
  killProcess: (pid: number) => void
  launchDesktop: (input: DesktopCdpLaunchInput) => Promise<DesktopCdpLaunchResult>
  listEvidenceSessions: typeof listRuntimeEvidenceSessions
  now: () => Date
  recordDemoVideo: (input: DemoVideoRecordOptions) => Promise<DemoVideoRecordResult>
  waitForEvidenceReply: typeof waitForRuntimeEvidenceReply
}

export interface DesktopControlServer {
  baseUrl: string
  close: () => Promise<void>
  server: http.Server
  state: DesktopControlServerState
}

const defaultDeps: DesktopControlServerDeps = {
  getTargets: getChromeDebugTargets,
  killProcess: (pid) => {
    process.kill(pid)
  },
  launchDesktop: async input =>
    await runDesktopCdpLaunch({
      ...input,
      json: true,
      stdout: {
        write: () => true
      }
    }),
  listEvidenceSessions: listRuntimeEvidenceSessions,
  now: () => new Date(),
  recordDemoVideo: async (input) => {
    const scenario = getDemoVideoScenario(input.scenarioId)
    return await recordDemoVideoScenario(scenario, input)
  },
  waitForEvidenceReply: waitForRuntimeEvidenceReply
}

const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value != null && !Array.isArray(value)
)

const normalizeString = (value: unknown) => {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}

const normalizePositiveInteger = (value: unknown) => {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) return undefined
  return value
}

const normalizeDemoVideoColorScheme = (value: unknown): DemoVideoColorScheme | undefined => {
  if (value === 'dark' || value === 'light' || value === 'system') return value
  return undefined
}

const normalizeDemoVideoCaptureSource = (value: unknown): DemoVideoCaptureSource | undefined => {
  if (value === 'cdp' || value === 'system-display' || value === 'system-window') return value
  return undefined
}

const normalizeDemoVideoPageBackground = (value: unknown): DemoVideoPageBackground | undefined => {
  if (value === 'app' || value === 'macos-wallpaper') return value
  return undefined
}

const normalizeSystemWindowCaptureBackend = (value: unknown): DemoVideoSystemWindowCaptureBackend | undefined => {
  if (value === 'video' || value === 'frames') return value
  return undefined
}

const normalizeVideoBackgroundColor = (value: unknown) => {
  if (typeof value !== 'string') return undefined
  const match = /^(?:#|0x)?([0-9a-fA-F]{6})$/u.exec(value.trim())
  return match == null ? undefined : `0x${match[1]!.toUpperCase()}`
}

const normalizeDemoVideoLanguage = (value: unknown) => {
  if (typeof value !== 'string') return undefined
  const normalized = value.trim().replaceAll('_', '-')
  if (normalized === '' || !/^[a-zA-Z]{2,3}(?:-[a-zA-Z0-9]{2,8})*$/u.test(normalized)) return undefined
  return normalized
}

const jsonResponse = (
  response: http.ServerResponse,
  statusCode: number,
  body: unknown
) => {
  response.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8'
  })
  response.end(`${JSON.stringify(body, null, 2)}\n`)
}

const okResponse = (response: http.ServerResponse, phase: string, data: unknown = {}) => {
  jsonResponse(response, 200, {
    ok: true,
    phase,
    data
  })
}

const errorResponse = (
  response: http.ServerResponse,
  statusCode: number,
  code: string,
  message: string
) => {
  jsonResponse(response, statusCode, {
    ok: false,
    error: {
      code,
      message
    }
  })
}

const errorResponseFromUnknown = (response: http.ServerResponse, error: unknown) => {
  if (isRecord(error) && typeof error.statusCode === 'number' && typeof error.code === 'string') {
    errorResponse(
      response,
      error.statusCode,
      error.code,
      error instanceof Error ? error.message : String(error.message ?? error.code)
    )
    return
  }
  errorResponse(response, 500, 'INTERNAL_ERROR', error instanceof Error ? error.message : String(error))
}

const readJsonBody = async (request: http.IncomingMessage) => {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.byteLength
    if (size > REQUEST_BODY_LIMIT_BYTES) {
      throw new Error('Request body is too large.')
    }
    chunks.push(buffer)
  }

  const content = Buffer.concat(chunks).toString('utf8').trim()
  if (content === '') return {}
  const parsed = JSON.parse(content) as unknown
  if (!isRecord(parsed)) {
    throw new Error('Request body must be a JSON object.')
  }
  return parsed
}

const buildProtocolDocument = (baseUrl: string) => ({
  name: PROTOCOL_NAME,
  version: PROTOCOL_VERSION,
  baseUrl,
  endpoints: [
    {
      method: 'GET',
      path: '/health',
      intent: 'Check bridge readiness.'
    },
    {
      method: 'GET',
      path: '/protocol',
      intent: 'Read the agent-facing protocol document.'
    },
    {
      method: 'POST',
      path: '/v1/electron/sessions',
      intent: 'Cold-launch an isolated Electron control session.',
      body: {
        address: 'optional CDP bind address',
        appPath: 'optional installed .app or executable path',
        executable: 'optional explicit executable path',
        allowUnsupportedApp: 'optional unsafe bypass for the external CDP hook check',
        port: 'optional CDP port',
        userDataDir: 'optional isolated Electron userData directory',
        waitMs: 'optional CDP readiness timeout',
        workspace: 'optional workspace folder to open'
      }
    },
    {
      method: 'GET',
      path: '/v1/electron/sessions',
      intent: 'List launched control sessions.'
    },
    {
      method: 'GET',
      path: '/v1/electron/sessions/:sessionId/targets',
      intent: 'Refresh CDP targets for a launched control session.'
    },
    {
      method: 'POST',
      path: '/v1/electron/sessions/:sessionId/recordings',
      intent: 'Record the current Electron UI page via the reusable demo-video recorder.',
      body: {
        captureSource:
          'required diagnostic source: system-display or cdp; formal Electron videos use record-batch --use-deskpad-display',
        chromePath: 'optional Chrome executable path',
        colorScheme: 'optional light, dark, or system',
        durationMs: 'optional scenario duration for generic scenarios',
        ffmpegPath: 'optional ffmpeg executable path',
        fps: 'optional recording frame rate',
        height: 'optional viewport height',
        keepFrames: 'optional raw PNG frame retention',
        language: 'optional interface language override, for example zh or en',
        name: 'optional output basename',
        outDir: 'optional output directory',
        pageBackground: 'optional app or macos-wallpaper',
        pageBackgroundImage: 'optional explicit image path for the page background',
        scenarioId: 'optional demo-video scenario id; defaults to current-page-tour',
        systemDisplayId: 'macOS screencapture display number for system-display diagnostics',
        systemWindowCaptureBackend: 'legacy diagnostic only; do not use for formal Electron evidence',
        targetUrl: 'optional explicit URL; defaults to current Electron page target',
        videoBackgroundColor: 'legacy diagnostic only',
        videoBackgroundImage: 'legacy diagnostic only',
        waitForText: 'optional visible text to wait for before recording the first frame',
        waitForTextAbsent: 'optional text that must disappear before recording the first frame',
        waitForTextAbsentTimeoutMs: 'optional waitForTextAbsent timeout',
        waitForTextTimeoutMs: 'optional waitForText timeout',
        width: 'optional viewport width'
      }
    },
    {
      method: 'DELETE',
      path: '/v1/electron/sessions/:sessionId',
      intent: 'Terminate a launched Electron process when the bridge still knows its pid.'
    },
    {
      method: 'GET',
      path: '/v1/evidence/sessions?limit=20&projectHome=/path',
      intent: 'List bounded runtime evidence sessions.'
    },
    {
      method: 'POST',
      path: '/v1/evidence/wait-reply',
      intent: 'Wait for a runtime assistant reply by nonce or explicit session id.',
      body: {
        expectedReply: 'assistant reply substring / nonce',
        homeDir: 'optional real HOME',
        projectHome: 'optional project home',
        sessionId: 'optional runtime session id',
        waitMs: 'optional timeout'
      }
    }
  ]
})

const createSessionId = (now: Date) => `desktop-${now.getTime().toString(36)}`

const parseLaunchInput = (body: Record<string, unknown>): DesktopCdpLaunchInput => ({
  address: normalizeString(body.address),
  allowUnsupportedApp: body.allowUnsupportedApp === true,
  appPath: normalizeString(body.appPath),
  executable: normalizeString(body.executable),
  port: normalizePositiveInteger(body.port),
  userDataDir: normalizeString(body.userDataDir),
  waitMs: normalizePositiveInteger(body.waitMs),
  workspace: normalizeString(body.workspace)
})

const parseWaitEvidenceInput = (body: Record<string, unknown>) => ({
  expectedReply: normalizeString(body.expectedReply),
  homeDir: normalizeString(body.homeDir),
  projectHome: normalizeString(body.projectHome),
  sessionId: normalizeString(body.sessionId),
  waitMs: normalizePositiveInteger(body.waitMs)
})

const parseRecordInput = (body: Record<string, unknown>) => ({
  captureSource: normalizeDemoVideoCaptureSource(body.captureSource),
  chromePath: normalizeString(body.chromePath),
  colorScheme: normalizeDemoVideoColorScheme(body.colorScheme),
  durationMs: normalizePositiveInteger(body.durationMs),
  ffmpegPath: normalizeString(body.ffmpegPath),
  followCdpTargets: typeof body.followCdpTargets === 'boolean' ? body.followCdpTargets : undefined,
  fps: normalizePositiveInteger(body.fps),
  height: normalizePositiveInteger(body.height),
  keepFrames: body.keepFrames === true,
  language: normalizeDemoVideoLanguage(body.language),
  name: normalizeString(body.name),
  outDir: normalizeString(body.outDir),
  pageBackground: normalizeDemoVideoPageBackground(body.pageBackground),
  pageBackgroundImage: normalizeString(body.pageBackgroundImage),
  preserveTargetEnvironment: typeof body.preserveTargetEnvironment === 'boolean'
    ? body.preserveTargetEnvironment
    : undefined,
  scenarioId: normalizeString(body.scenarioId) ?? 'current-page-tour',
  systemDisplayId: normalizePositiveInteger(body.systemDisplayId),
  systemWindowCaptureBackend: normalizeSystemWindowCaptureBackend(body.systemWindowCaptureBackend),
  targetUrl: normalizeString(body.targetUrl),
  videoBackgroundColor: normalizeVideoBackgroundColor(body.videoBackgroundColor),
  videoBackgroundImage: normalizeString(body.videoBackgroundImage),
  waitForText: normalizeString(body.waitForText),
  waitForTextAbsent: normalizeString(body.waitForTextAbsent),
  waitForTextAbsentTimeoutMs: normalizePositiveInteger(body.waitForTextAbsentTimeoutMs),
  waitForTextTimeoutMs: normalizePositiveInteger(body.waitForTextTimeoutMs),
  workspace: normalizeString(body.workspace),
  width: normalizePositiveInteger(body.width)
})

const getSessionFromPath = (pathname: string) => {
  const match = /^\/v1\/electron\/sessions\/([^/]+)(?:\/(targets|recordings))?$/u.exec(pathname)
  if (match == null) return undefined
  return {
    sessionId: decodeURIComponent(match[1]!),
    targetAction: match[2]
  }
}

const findRecordableTarget = (
  targets: Awaited<ReturnType<typeof getChromeDebugTargets>>,
  targetUrl?: string
) => (
  targets.find(item =>
    item.type === 'page' &&
    normalizeString(item.url) != null &&
    (targetUrl == null || item.url === targetUrl) &&
    !item.url.startsWith('about:') &&
    !item.url.startsWith('devtools:')
  )
)

const handleRequest = async (input: {
  baseUrl: string
  deps: DesktopControlServerDeps
  request: http.IncomingMessage
  response: http.ServerResponse
  state: DesktopControlServerState
}) => {
  const { baseUrl, deps, request, response, state } = input
  const url = new URL(request.url ?? '/', baseUrl)

  if (request.method === 'GET' && url.pathname === '/health') {
    okResponse(response, 'ready', {
      protocol: PROTOCOL_NAME,
      version: PROTOCOL_VERSION,
      sessions: state.sessions.size
    })
    return
  }

  if (request.method === 'GET' && url.pathname === '/protocol') {
    okResponse(response, 'protocol', buildProtocolDocument(baseUrl))
    return
  }

  if (request.method === 'POST' && url.pathname === '/v1/electron/sessions') {
    const body = await readJsonBody(request)
    const launched = await deps.launchDesktop(parseLaunchInput(body))
    const now = deps.now()
    const sessionId = createSessionId(now)
    const record: DesktopControlSessionRecord = {
      createdAt: now.toISOString(),
      launch: launched,
      sessionId
    }
    state.sessions.set(sessionId, record)
    okResponse(response, 'electron.session.ready', {
      ...record,
      agentCommands: [
        ...launched.agentCommands,
        {
          args: ['GET', `${baseUrl}/v1/electron/sessions/${encodeURIComponent(sessionId)}/targets`],
          command: 'fetch',
          commandLine: `GET ${baseUrl}/v1/electron/sessions/${encodeURIComponent(sessionId)}/targets`,
          cwd: process.cwd(),
          intent: 'refresh-electron-cdp-targets'
        },
        {
          args: ['POST', `${baseUrl}/v1/electron/sessions/${encodeURIComponent(sessionId)}/recordings`],
          command: 'fetch',
          commandLine: `POST ${baseUrl}/v1/electron/sessions/${encodeURIComponent(sessionId)}/recordings`,
          cwd: process.cwd(),
          intent: 'record-electron-session-video'
        }
      ]
    })
    return
  }

  if (request.method === 'GET' && url.pathname === '/v1/electron/sessions') {
    okResponse(response, 'electron.sessions', {
      sessions: [...state.sessions.values()]
    })
    return
  }

  const sessionPath = getSessionFromPath(url.pathname)
  if (sessionPath != null && request.method === 'GET' && sessionPath.targetAction === 'targets') {
    const session = state.sessions.get(sessionPath.sessionId)
    if (session == null) {
      errorResponse(response, 404, 'SESSION_NOT_FOUND', `Unknown desktop control session: ${sessionPath.sessionId}`)
      return
    }
    const targets = await deps.getTargets(session.launch.port)
    okResponse(response, 'electron.targets', {
      sessionId: sessionPath.sessionId,
      targets
    })
    return
  }

  if (sessionPath != null && request.method === 'POST' && sessionPath.targetAction === 'recordings') {
    const session = state.sessions.get(sessionPath.sessionId)
    if (session == null) {
      errorResponse(response, 404, 'SESSION_NOT_FOUND', `Unknown desktop control session: ${sessionPath.sessionId}`)
      return
    }

    const body = await readJsonBody(request)
    const recordInput = parseRecordInput(body)
    const targets = await deps.getTargets(session.launch.port)
    const target = findRecordableTarget(targets, recordInput.targetUrl) ??
      findRecordableTarget(session.launch.targets, recordInput.targetUrl) ??
      findRecordableTarget(targets) ??
      findRecordableTarget(session.launch.targets)
    const targetUrl = recordInput.targetUrl ?? normalizeString(target?.url)

    if (targetUrl == null) {
      errorResponse(
        response,
        409,
        'NO_RECORDABLE_ELECTRON_TARGET',
        `No recordable page target was found for desktop control session: ${sessionPath.sessionId}`
      )
      return
    }

    if (recordInput.captureSource == null) {
      errorResponse(
        response,
        400,
        'CAPTURE_SOURCE_REQUIRED',
        'Ad-hoc Electron recordings require an explicit captureSource. Formal Electron videos must use desktop-control record-batch --use-deskpad-display.'
      )
      return
    }

    const captureSource = recordInput.captureSource
    const recording = await deps.recordDemoVideo({
      captureSource,
      chromePath: recordInput.chromePath,
      cdpWebSocketDebuggerUrl: normalizeString(target?.webSocketDebuggerUrl),
      colorScheme: recordInput.colorScheme,
      durationMs: recordInput.durationMs,
      ffmpegPath: recordInput.ffmpegPath,
      followCdpTargets: recordInput.followCdpTargets ?? recordInput.scenarioId === 'launcher-open-workspace-ui-tour',
      fps: recordInput.fps,
      height: recordInput.height,
      json: true,
      keepFrames: recordInput.keepFrames,
      language: recordInput.language,
      name: recordInput.name,
      outDir: recordInput.outDir,
      pageBackground: recordInput.pageBackground,
      pageBackgroundImage: recordInput.pageBackgroundImage,
      preserveTargetEnvironment: recordInput.preserveTargetEnvironment ?? true,
      scenarioId: recordInput.scenarioId,
      systemDisplayId: recordInput.systemDisplayId,
      systemWindowCaptureBackend: recordInput.systemWindowCaptureBackend,
      systemWindowOwnerPid: captureSource === 'system-window' ? session.launch.pid : undefined,
      url: targetUrl,
      videoBackgroundColor: recordInput.videoBackgroundColor,
      videoBackgroundImage: recordInput.videoBackgroundImage,
      waitForText: recordInput.waitForText,
      waitForTextAbsent: recordInput.waitForTextAbsent,
      waitForTextAbsentTimeoutMs: recordInput.waitForTextAbsentTimeoutMs,
      waitForTextTimeoutMs: recordInput.waitForTextTimeoutMs,
      workspace: recordInput.workspace,
      width: recordInput.width
    })
    okResponse(response, 'electron.recording.ready', {
      recording,
      sessionId: sessionPath.sessionId,
      targetUrl,
      targets
    })
    return
  }

  if (sessionPath != null && request.method === 'DELETE') {
    const session = state.sessions.get(sessionPath.sessionId)
    if (session == null) {
      errorResponse(response, 404, 'SESSION_NOT_FOUND', `Unknown desktop control session: ${sessionPath.sessionId}`)
      return
    }
    if (session.launch.pid != null) {
      deps.killProcess(session.launch.pid)
    }
    state.sessions.delete(sessionPath.sessionId)
    okResponse(response, 'electron.session.deleted', {
      sessionId: sessionPath.sessionId
    })
    return
  }

  if (request.method === 'GET' && url.pathname === '/v1/evidence/sessions') {
    const limit = normalizePositiveInteger(Number(url.searchParams.get('limit'))) ?? 20
    const sessions = await deps.listEvidenceSessions({
      homeDir: normalizeString(url.searchParams.get('homeDir') ?? undefined),
      limit,
      projectHome: normalizeString(url.searchParams.get('projectHome') ?? undefined)
    })
    okResponse(response, 'runtime.evidence.sessions', {
      sessions
    })
    return
  }

  if (request.method === 'POST' && url.pathname === '/v1/evidence/wait-reply') {
    const body = await readJsonBody(request)
    const result: RuntimeEvidenceWaitResult = await deps.waitForEvidenceReply(parseWaitEvidenceInput(body))
    okResponse(response, result.ok ? 'runtime.evidence.reply.ready' : 'runtime.evidence.reply.missing', result)
    return
  }

  errorResponse(response, 404, 'NOT_FOUND', `${request.method ?? 'GET'} ${url.pathname} is not supported.`)
}

export const startDesktopControlServer = async (
  input: DesktopControlServeInput = {},
  deps: Partial<DesktopControlServerDeps> = {}
): Promise<DesktopControlServer> => {
  const resolvedDeps: DesktopControlServerDeps = {
    ...defaultDeps,
    ...deps
  }
  const state: DesktopControlServerState = {
    sessions: new Map()
  }
  const host = input.host ?? DEFAULT_CONTROL_HOST
  const server = http.createServer((request, response) => {
    const address = server.address()
    const port = typeof address === 'object' && address != null ? address.port : input.port ?? DEFAULT_CONTROL_PORT
    const baseUrl = `http://${host}:${port}`
    void handleRequest({
      baseUrl,
      deps: resolvedDeps,
      request,
      response,
      state
    }).catch((error) => {
      errorResponseFromUnknown(response, error)
    })
  })

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(input.port ?? DEFAULT_CONTROL_PORT, host, () => resolve())
  })

  const address = server.address()
  if (typeof address !== 'object' || address == null) {
    throw new Error('Desktop control server did not bind to a TCP port.')
  }

  return {
    baseUrl: `http://${host}:${address.port}`,
    close: async () => {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error != null) reject(error)
          else resolve()
        })
      })
    },
    server,
    state
  }
}

const buildServeReadyPayload = (baseUrl: string) => ({
  ok: true,
  phase: 'desktop-control.ready',
  data: {
    protocol: PROTOCOL_NAME,
    version: PROTOCOL_VERSION,
    baseUrl,
    endpoints: {
      health: `${baseUrl}/health`,
      protocol: `${baseUrl}/protocol`,
      createElectronSession: `${baseUrl}/v1/electron/sessions`,
      recordElectronSession: `${baseUrl}/v1/electron/sessions/{sessionId}/recordings`,
      waitRuntimeReply: `${baseUrl}/v1/evidence/wait-reply`
    },
    agentCommands: [
      {
        command: 'fetch',
        intent: 'read-protocol',
        method: 'GET',
        url: `${baseUrl}/protocol`
      },
      {
        command: 'fetch',
        intent: 'create-electron-control-session',
        method: 'POST',
        url: `${baseUrl}/v1/electron/sessions`
      }
    ]
  }
})

export const runDesktopControlServe = async (input: DesktopControlServeInput = {}) => {
  const controlServer = await startDesktopControlServer(input)
  const stdout = input.stdout ?? process.stdout
  const payload = buildServeReadyPayload(controlServer.baseUrl)

  if (input.text === true) {
    stdout.write(`[desktop-control] ready ${controlServer.baseUrl}\n`)
  } else {
    stdout.write(`${JSON.stringify(payload, null, 2)}\n`)
  }

  await new Promise<void>(() => {})
}
