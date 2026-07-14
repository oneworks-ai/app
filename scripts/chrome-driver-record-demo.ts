import { spawn } from 'node:child_process'
import { access, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import process from 'node:process'

import { recordDemoVideoScenario } from './demo-video/recorder'
import type { DemoVideoScenario } from './demo-video/types'

async function main() {
  const workspaceFolder = resolve(process.cwd())
  const outDir = resolve(process.env.CHROME_DRIVER_DEMO_OUTPUT ?? join(workspaceFolder, '.logs/chrome-driver-demo'))
  const controlPath = join(outDir, 'recorder-control.json')
  const startPath = join(outDir, 'recorder-start')
  const runCompletePath = join(outDir, 'e2e-run-complete')
  const donePath = join(outDir, 'recorder-done')
  const e2eOutput = join(outDir, 'e2e')
  const captureSource = process.env.CHROME_DRIVER_DEMO_CAPTURE === 'system-window'
    ? 'system-window'
    : process.env.CHROME_DRIVER_DEMO_CAPTURE === 'system-display'
    ? 'system-display'
    : 'cdp'
  const systemWindowCaptureBackend = process.env.CHROME_DRIVER_DEMO_WINDOW_BACKEND === 'frames' ? 'frames' : 'video'
  const durationMs = Number(process.env.CHROME_DRIVER_DEMO_DURATION_MS ?? 45_000)
  const fps = Number(process.env.CHROME_DRIVER_DEMO_FPS ?? 5)
  if (!Number.isFinite(fps) || fps <= 0) {
    throw new TypeError(`CHROME_DRIVER_DEMO_FPS must be a positive number; received ${String(fps)}.`)
  }

  await mkdir(outDir, { recursive: true })
  await Promise.all([
    rm(controlPath, { force: true }),
    rm(startPath, { force: true }),
    rm(runCompletePath, { force: true }),
    rm(donePath, { force: true }),
    rm(e2eOutput, { force: true, recursive: true })
  ])

  let stdout = ''
  let stderr = ''
  const child = spawn(process.execPath, [join(workspaceFolder, 'scripts/chrome-driver-e2e.mjs')], {
    cwd: workspaceFolder,
    env: {
      ...process.env,
      CHROME_DRIVER_E2E_DEMO: '1',
      CHROME_DRIVER_E2E_DEMO_CONTROL: controlPath,
      CHROME_DRIVER_E2E_DEMO_DONE: donePath,
      CHROME_DRIVER_E2E_DEMO_RUN_COMPLETE: runCompletePath,
      CHROME_DRIVER_E2E_DEMO_START: startPath,
      CHROME_DRIVER_E2E_OUTPUT: e2eOutput
    },
    stdio: ['ignore', 'pipe', 'pipe']
  })
  child.stdout.on('data', chunk => {
    stdout += chunk.toString()
  })
  child.stderr.on('data', chunk => {
    stderr += chunk.toString()
  })

  const childExit = new Promise<void>((resolveExit, rejectExit) => {
    child.once('exit', code =>
      code === 0
        ? resolveExit()
        : rejectExit(new Error(`Chrome Driver demo E2E exited ${code}: ${stderr.slice(-4000)}`)))
  })

  const deadline = Date.now() + 45_000
  while (Date.now() < deadline) {
    try {
      await access(controlPath)
      break
    } catch {
      await new Promise(resolveWait => setTimeout(resolveWait, 100))
    }
  }

  let result
  try {
    const control = JSON.parse(await readFile(controlPath, 'utf8')) as {
      cdp_websocket_url?: string
      chrome_pid?: number
    }
    if (typeof control.cdp_websocket_url !== 'string' || !Number.isInteger(control.chrome_pid)) {
      throw new TypeError(`Chrome Driver demo control data is invalid: ${JSON.stringify(control)}`)
    }
    const scenario: DemoVideoScenario = {
      defaultDurationMs: durationMs,
      defaultFps: fps,
      defaultViewport: { height: 900, width: 1280 },
      description: 'Outer-process recording of OneWorks controlling an isolated external browser window.',
      id: 'external-browser-driver-e2e',
      requiresUrl: false,
      showActionCursor: false,
      title: 'OneWorks Chrome Driver E2E',
      run: async ctx => {
        await ctx.recordDuring(ctx.durationMs, async () => {
          await writeFile(startPath, `${new Date().toISOString()}\n`, { mode: 0o600 })
          const actionDeadline = Date.now() + 60_000
          while (Date.now() < actionDeadline) {
            try {
              await access(runCompletePath)
              return
            } catch {
              await new Promise(resolveWait => setTimeout(resolveWait, 100))
            }
          }
          throw new Error('Chrome Driver demo E2E did not complete its visible actions.')
        })
      }
    }
    result = await recordDemoVideoScenario(scenario, {
      captureSource,
      cdpWebSocketDebuggerUrl: control.cdp_websocket_url,
      colorScheme: 'dark',
      durationMs,
      followCdpTargets: true,
      fps,
      headless: false,
      keepFrames: false,
      language: 'zh-Hans',
      name: 'oneworks-browser-control',
      outDir,
      preserveTargetEnvironment: true,
      scenarioId: scenario.id,
      showActionCursor: false,
      ...(captureSource === 'system-window'
        ? { systemWindowCaptureBackend, systemWindowOwnerPid: control.chrome_pid }
        : captureSource === 'system-display'
        ? { systemWindowCaptureBackend }
        : {})
    })
    await writeFile(donePath, `${new Date().toISOString()}\n`, { mode: 0o600 })
    await childExit
  } finally {
    await writeFile(donePath, `${new Date().toISOString()}\n`, { mode: 0o600 }).catch(() => undefined)
    if (child.exitCode == null) child.kill('SIGTERM')
  }

  process.stdout.write(`${JSON.stringify({ e2e_stdout: stdout.trim(), result }, null, 2)}\n`)
}

void main().catch(error => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`)
  process.exitCode = 1
})
