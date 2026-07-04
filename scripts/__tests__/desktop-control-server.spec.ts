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
    const launchDesktop = vi.fn(async () => ({
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
      targetCount: 1,
      targets: [{
        id: 'target-1',
        title: 'One Works',
        type: 'page',
        url: 'http://127.0.0.1:5173/',
        webSocketDebuggerUrl: 'ws://127.0.0.1:9444/devtools/page/target-1'
      }],
      userDataDir: '/tmp/ow-agent'
    }))
    const getTargets = vi.fn(async () => [{
      id: 'target-2',
      title: 'One Works Workspace',
      type: 'page',
      url: 'http://127.0.0.1:5173/workspace',
      webSocketDebuggerUrl: 'ws://127.0.0.1:9444/devtools/page/target-2'
    }])
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
