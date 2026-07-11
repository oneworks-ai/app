import { afterEach, describe, expect, it, vi } from 'vitest'

import { DesktopCdpUnsupportedAppError } from '../desktop-cdp'
import { startDesktopControlServer } from '../desktop-control-server'
import type { DesktopControlServer } from '../desktop-control-server'

let controlServer: DesktopControlServer | undefined

afterEach(async () => {
  await controlServer?.close()
  controlServer = undefined
})

const readJson = async (response: Response) => {
  expect(response.headers.get('content-type')).toContain('application/json')
  return await response.json() as Record<string, unknown>
}

const createLaunchResult = () => ({
  address: '127.0.0.1',
  agentCommands: [],
  appPath: '/Applications/One Works.app',
  control: {
    cdpEndpoint: 'http://127.0.0.1:9444',
    protocol: 'cdp' as const,
    target: 'electron' as const
  },
  endpoint: 'http://127.0.0.1:9444',
  executablePath: '/Applications/One Works.app/Contents/MacOS/One Works',
  nextActions: [],
  ok: true,
  phase: 'ready' as const,
  pid: 12345,
  port: 9444,
  processFingerprint: 'electron-process-fingerprint',
  targetCount: 1,
  targets: [{
    id: 'target-1',
    title: 'One Works',
    type: 'page',
    url: 'http://127.0.0.1:5173/',
    webSocketDebuggerUrl: 'ws://127.0.0.1:9444/devtools/page/target-1'
  }],
  userDataDir: '/tmp/ow-agent'
})

describe('desktop control server', () => {
  it('publishes protocol metadata for agents', async () => {
    controlServer = await startDesktopControlServer()

    const response = await fetch(`${controlServer.baseUrl}/protocol`)
    const body = await readJson(response)

    expect(response.status).toBe(200)
    expect(body).toMatchObject({
      ok: true,
      phase: 'protocol'
    })
    expect(body.data).toMatchObject({
      name: 'oneworks.desktop-control',
      version: 1,
      baseUrl: controlServer.baseUrl
    })
  })

  it('bridges Electron launch, target refresh, and runtime evidence', async () => {
    const launchDesktop = vi.fn(async () => createLaunchResult())
    const getTargets = vi.fn(async () => [{
      id: 'target-2',
      title: 'One Works Workspace',
      type: 'page',
      url: 'http://127.0.0.1:5173/workspace',
      webSocketDebuggerUrl: 'ws://127.0.0.1:9444/devtools/page/target-2'
    }])
    const terminateProcess = vi.fn(async () => {})
    const waitForEvidenceReply = vi.fn(async () => ({
      assistantText: 'OK_AGENT_BRIDGE',
      completed: true,
      elapsedMs: 5,
      eventsPath: '/tmp/events.jsonl',
      message: 'matched',
      ok: true,
      scannedFiles: 1,
      sessionId: 'runtime-session'
    }))
    const recordDemoVideo = vi.fn(async () => ({
      colorScheme: 'light' as const,
      durationMs: 1000,
      fps: 5,
      frameCount: 5,
      framesDir: '/tmp/oneworks-recording/frames',
      height: 720,
      keptFrames: true,
      language: 'en',
      posterPath: '/tmp/oneworks-recording/electron-smoke-poster.png',
      scenarioId: 'current-page-tour',
      scenarioTitle: '当前页面展示',
      stillFramePaths: ['/tmp/oneworks-recording/stills/second_0000.png'],
      stills: [{
        imagePath: '/tmp/oneworks-recording/stills/second_0000.png',
        index: 0,
        timestampMs: 0
      }],
      stillsDir: '/tmp/oneworks-recording/stills',
      stillsManifestPath: '/tmp/oneworks-recording/electron-smoke-stills.json',
      videoPath: '/tmp/oneworks-recording/electron-smoke.mp4',
      width: 1280
    }))
    controlServer = await startDesktopControlServer({}, {
      getTargets,
      launchDesktop,
      now: () => new Date('2026-07-01T00:00:00.000Z'),
      recordDemoVideo,
      terminateProcess,
      waitForEvidenceReply
    })

    const createResponse = await fetch(`${controlServer.baseUrl}/v1/electron/sessions`, {
      body: JSON.stringify({
        port: 9444,
        workspace: '/tmp/workspace'
      }),
      method: 'POST'
    })
    const createBody = await readJson(createResponse)
    const createData = createBody.data as {
      agentCommands: Array<{ intent: string }>
      sessionId: string
    }

    expect(createResponse.status).toBe(200)
    expect(createBody).toMatchObject({
      ok: true,
      phase: 'electron.session.ready'
    })
    expect(createData.sessionId).toMatch(/^desktop-/u)
    expect(controlServer.state.sessions.get(createData.sessionId)).toMatchObject({
      processFingerprint: 'electron-process-fingerprint'
    })
    expect(createData.agentCommands.some(command => command.intent === 'refresh-electron-cdp-targets')).toBe(true)
    expect(createData.agentCommands.some(command => command.intent === 'record-electron-session-video')).toBe(true)
    expect(launchDesktop).toHaveBeenCalledWith(expect.objectContaining({
      port: 9444,
      workspace: '/tmp/workspace'
    }))

    const targetResponse = await fetch(
      `${controlServer.baseUrl}/v1/electron/sessions/${createData.sessionId}/targets`
    )
    const targetBody = await readJson(targetResponse)

    expect(targetResponse.status).toBe(200)
    expect(targetBody).toMatchObject({
      ok: true,
      phase: 'electron.targets'
    })
    expect(getTargets).toHaveBeenCalledWith(9444)

    const recordingResponse = await fetch(
      `${controlServer.baseUrl}/v1/electron/sessions/${createData.sessionId}/recordings`,
      {
        body: JSON.stringify({
          captureSource: 'system-display',
          durationMs: 1000,
          keepFrames: true,
          language: 'en',
          name: 'electron-smoke',
          outDir: '/tmp/oneworks-recording',
          systemDisplayId: 2,
          waitForText: '输入消息',
          waitForTextAbsent: '项目正在就位',
          waitForTextAbsentTimeoutMs: 30000,
          waitForTextTimeoutMs: 30000,
          width: 1280
        }),
        method: 'POST'
      }
    )
    const recordingBody = await readJson(recordingResponse)

    expect(recordingResponse.status).toBe(200)
    expect(recordingBody).toMatchObject({
      ok: true,
      phase: 'electron.recording.ready',
      data: {
        recording: {
          videoPath: '/tmp/oneworks-recording/electron-smoke.mp4'
        },
        targetUrl: 'http://127.0.0.1:5173/workspace'
      }
    })
    expect(recordDemoVideo).toHaveBeenCalledWith(expect.objectContaining({
      captureSource: 'system-display',
      cdpWebSocketDebuggerUrl: 'ws://127.0.0.1:9444/devtools/page/target-2',
      durationMs: 1000,
      json: true,
      keepFrames: true,
      language: 'en',
      name: 'electron-smoke',
      outDir: '/tmp/oneworks-recording',
      preserveTargetEnvironment: true,
      scenarioId: 'current-page-tour',
      systemDisplayId: 2,
      url: 'http://127.0.0.1:5173/workspace',
      waitForText: '输入消息',
      waitForTextAbsent: '项目正在就位',
      waitForTextAbsentTimeoutMs: 30000,
      waitForTextTimeoutMs: 30000,
      width: 1280
    }))

    const evidenceResponse = await fetch(`${controlServer.baseUrl}/v1/evidence/wait-reply`, {
      body: JSON.stringify({
        expectedReply: 'OK_AGENT_BRIDGE',
        waitMs: 1000
      }),
      method: 'POST'
    })
    const evidenceBody = await readJson(evidenceResponse)

    expect(evidenceBody).toMatchObject({
      ok: true,
      phase: 'runtime.evidence.reply.ready',
      data: {
        ok: true,
        assistantText: 'OK_AGENT_BRIDGE'
      }
    })
    expect(waitForEvidenceReply).toHaveBeenCalledWith(expect.objectContaining({
      expectedReply: 'OK_AGENT_BRIDGE',
      waitMs: 1000
    }))
    await controlServer.close()
    controlServer = undefined
    expect(terminateProcess).toHaveBeenCalledWith({
      fingerprint: 'electron-process-fingerprint',
      label: `desktop-control session ${createData.sessionId}`,
      pid: 12345,
      timeoutMs: 1_000
    })
  })

  it('retains session evidence when identity-safe close refuses the process', async () => {
    const terminateProcess = vi.fn(async () => {
      throw new Error('process identity no longer matches shared state')
    })
    controlServer = await startDesktopControlServer({}, {
      launchDesktop: async () => createLaunchResult(),
      terminateProcess
    })

    const response = await fetch(`${controlServer.baseUrl}/v1/electron/sessions`, {
      body: '{}',
      method: 'POST'
    })
    const body = await readJson(response)
    const sessionId = (body.data as { sessionId: string }).sessionId
    const server = controlServer
    controlServer = undefined

    await expect(server.close()).rejects.toThrow('Failed to terminate one or more desktop-control sessions')
    expect(terminateProcess).toHaveBeenCalledWith({
      fingerprint: 'electron-process-fingerprint',
      label: `desktop-control session ${sessionId}`,
      pid: 12345,
      timeoutMs: 1_000
    })
    expect(server.state.sessions.has(sessionId)).toBe(true)
  })

  it('keeps concurrent sessions distinct even when they share one timestamp', async () => {
    const terminateProcess = vi.fn(async () => {})
    controlServer = await startDesktopControlServer({}, {
      launchDesktop: async () => createLaunchResult(),
      now: () => new Date('2026-07-01T00:00:00.000Z'),
      terminateProcess
    })

    const responses = await Promise.all([
      fetch(`${controlServer.baseUrl}/v1/electron/sessions`, { body: '{}', method: 'POST' }),
      fetch(`${controlServer.baseUrl}/v1/electron/sessions`, { body: '{}', method: 'POST' })
    ])
    const sessions = await Promise.all(responses.map(async response => await readJson(response)))
    const ids = sessions.map(session => (session.data as { sessionId: string }).sessionId)
    expect(new Set(ids).size).toBe(2)
    expect(controlServer.state.sessions.size).toBe(2)
  })

  it('rejects and rolls back a launch without a verifiable process identity', async () => {
    const terminateProcess = vi.fn(async () => {})
    controlServer = await startDesktopControlServer({}, {
      launchDesktop: async () => ({ ...createLaunchResult(), processFingerprint: '' }),
      terminateProcess
    })

    const response = await fetch(`${controlServer.baseUrl}/v1/electron/sessions`, {
      body: '{}',
      method: 'POST'
    })
    expect(response.status).toBe(500)
    expect(controlServer.state.sessions.size).toBe(0)
    expect(terminateProcess).toHaveBeenCalledWith({
      fingerprint: undefined,
      label: 'invalid desktop-control launch',
      pid: 12345
    })
  })

  it('drains an in-flight session creation before closing and cleaning its process', async () => {
    let launchStarted = () => {}
    const started = new Promise<void>((resolve) => {
      launchStarted = resolve
    })
    let releaseLaunch = () => {}
    const launchGate = new Promise<void>((resolve) => {
      releaseLaunch = resolve
    })
    const terminateProcess = vi.fn(async () => {})
    controlServer = await startDesktopControlServer({}, {
      launchDesktop: async () => {
        launchStarted()
        await launchGate
        return createLaunchResult()
      },
      terminateProcess
    })

    const request = fetch(`${controlServer.baseUrl}/v1/electron/sessions`, {
      body: '{}',
      method: 'POST'
    })
    await started
    const server = controlServer
    const closing = server.close()
    releaseLaunch()
    await expect(request).rejects.toThrow()
    await closing
    controlServer = undefined

    expect(server.state.closing).toBe(true)
    expect(server.state.sessions.size).toBe(0)
    expect(terminateProcess).toHaveBeenCalledWith(expect.objectContaining({
      fingerprint: 'electron-process-fingerprint',
      pid: 12345,
      timeoutMs: 1_000
    }))
  })

  it('does not let a long evidence request delay session cleanup and server close', async () => {
    let waitStarted = () => {}
    const started = new Promise<void>((resolve) => {
      waitStarted = resolve
    })
    controlServer = await startDesktopControlServer({}, {
      waitForEvidenceReply: async () => {
        waitStarted()
        return await new Promise<never>(() => {})
      }
    })

    const request = fetch(`${controlServer.baseUrl}/v1/evidence/wait-reply`, {
      body: '{}',
      method: 'POST'
    })
    await started
    const server = controlServer
    const startedAt = Date.now()
    await server.close()
    controlServer = undefined

    expect(Date.now() - startedAt).toBeLessThan(500)
    await expect(request).rejects.toThrow()
  })

  it('returns a structured error when the installed app lacks the CDP hook', async () => {
    controlServer = await startDesktopControlServer({}, {
      launchDesktop: async () => {
        throw new DesktopCdpUnsupportedAppError('missing external CDP hook')
      }
    })

    const response = await fetch(`${controlServer.baseUrl}/v1/electron/sessions`, {
      body: JSON.stringify({
        appPath: '/Applications/One Works.app'
      }),
      method: 'POST'
    })
    const body = await readJson(response)

    expect(response.status).toBe(409)
    expect(body).toEqual({
      ok: false,
      error: {
        code: 'UNSUPPORTED_ELECTRON_APP',
        message: 'missing external CDP hook'
      }
    })
  })
})
