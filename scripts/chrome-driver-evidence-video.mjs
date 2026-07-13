#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import process from 'node:process'

const evidencePath = resolve(process.env.CHROME_DRIVER_EVIDENCE)
const screenshotPath = resolve(process.env.CHROME_DRIVER_ELECTRON_SCREENSHOT)
const outDir = resolve(process.env.CHROME_DRIVER_VIDEO_OUTPUT)
const evidence = JSON.parse(await readFile(evidencePath, 'utf8'))
if (evidence.error != null || !Array.isArray(evidence.checks) || evidence.checks.some(check => check.ok !== true)) {
  throw new Error('Chrome Driver evidence is not a fully successful run.')
}

await mkdir(outDir, { recursive: true })
const screenshot = (await readFile(screenshotPath)).toString('base64')
const checks = Object.fromEntries(evidence.checks.map(check => [check.name, check]))
const escape = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')

const line = (text, x, y, options = {}) =>
  `<text x="${x}" y="${y}" fill="${
    options.fill ?? '#edf4f7'
  }" font-family="-apple-system,BlinkMacSystemFont,Inter,sans-serif" font-size="${options.size ?? 26}" font-weight="${
    options.weight ?? 500
  }">${escape(text)}</text>`
const bullets = (items, x, y) =>
  items.map((item, index) =>
    `${line('✓', x, y + index * 48, { fill: '#59d0b2', size: 25, weight: 700 })}${
      line(item, x + 38, y + index * 48, { size: 24 })
    }`
  ).join('')
const shell = (title, eyebrow, body, image = false) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720">
  <defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#071116"/><stop offset="1" stop-color="#132a33"/></linearGradient><filter id="shadow"><feDropShadow dx="0" dy="14" stdDeviation="18" flood-opacity=".45"/></filter></defs>
  <rect width="1280" height="720" fill="url(#bg)"/><circle cx="1120" cy="80" r="260" fill="#2c8298" opacity=".11"/>
  ${line(eyebrow.toUpperCase(), 64, 58, { fill: '#6fb8ca', size: 17, weight: 700 })}
  ${line(title, 64, 112, { size: 40, weight: 750 })}
  <rect x="64" y="144" width="1152" height="2" fill="#3a5d66"/>
  ${body}
  ${
    image
      ? `<rect x="620" y="182" width="570" height="428" rx="18" fill="#05090b" filter="url(#shadow)"/><image x="632" y="194" width="546" height="404" preserveAspectRatio="xMidYMid slice" href="data:image/png;base64,${screenshot}"/>`
      : ''
  }
  <rect x="64" y="665" width="1152" height="1" fill="#31515a"/>${
    line('OUTER E2E HARNESS', 64, 697, { fill: '#73929a', size: 15, weight: 700 })
  }${line('Chrome 147 · typed request/ack · opt-in advanced access', 862, 697, { fill: '#73929a', size: 15 })}
</svg>`

const slides = [
  shell(
    'oneWorks takes control of an External Browser',
    'Recorded verification',
    `${line('Real packaged Electron', 64, 210, { size: 27, weight: 650 })}${
      line('+ real extension bridge', 64, 246, { size: 27, weight: 650 })
    }${line('Actual runtime control surface →', 64, 292, { fill: '#a8bbc1', size: 20 })}${
      bullets(['Trusted-origin handshake', 'Capability negotiation', 'Recoverable connection state'], 82, 370)
    }`,
    true
  ),
  shell(
    'Connection, permissions, and recovery',
    'Phase 1',
    bullets(
      [
        `Base extension paired · ${checks['base-extension-paired'].connection_id}`,
        `Missing permission reported · ${checks['missing-permission-recoverable'].missing_permissions.join(', ')}`,
        'Permission upgrade followed by disconnect/reconnect',
        `Protocol mismatch rejected · ${checks['version-mismatch-recoverable'].code}`
      ],
      92,
      226
    )
  ),
  shell(
    'Explicit targets keep concurrent work isolated',
    'Phase 2',
    bullets(
      [
        `Tabs ${checks['tabs-and-window-created'].tab_ids.join(' and ')} created`,
        `Window ${checks['tabs-and-window-created'].window_id} created independently`,
        `oneWorks Web tab rebound to ${checks['explicit-tab-identity-rebound'].tab_id}`,
        'Same target serialized; distinct targets execute concurrently'
      ],
      92,
      226
    )
  ),
  shell(
    'Semantic interaction and MCP workflow',
    'Phase 3',
    `${
      bullets(
        [
          `Typed “oneWorks” into ${checks['semantic-page-interaction'].input_ref}`,
          `Clicked ${checks['semantic-page-interaction'].button_ref} and observed result`,
          `Workflow ${checks['mcp-workflow-request-ack-and-progressive-result'].run_id} succeeded`,
          `${checks['mcp-workflow-request-ack-and-progressive-result'].step_ids.length} progressive step ids returned`
        ],
        92,
        226
      )
    }${line('snapshot → continue checkpoint → wait', 130, 478, { fill: '#75bfd0', size: 24, weight: 650 })}`
  ),
  shell(
    'Advanced access stays explicit and session-scoped',
    'Phase 4',
    bullets(
      [
        'User enabled raw CDP/JavaScript, complete cookies, and sensitive fields',
        `Exact tab ${checks['raw-cdp-cookie-and-sensitive-field-access'].tab_id} and origin were bound`,
        'Each sensitive operation received a separate R4 approval',
        'Raw page storage, cookie value, and password field checks passed'
      ],
      92,
      226
    )
  ),
  shell(
    'Frame identity survives cross-origin isolation',
    'Phase 5',
    bullets(
      [
        `Tab ${checks['iframe-isolation-and-injection'].tab_id}`,
        `Frame ${checks['iframe-isolation-and-injection'].frame_id}`,
        `Document ${checks['iframe-isolation-and-injection'].document_id}`,
        `Tab group ${checks['tab-group-control'].group_id} created, updated, and removed`
      ],
      92,
      226
    )
  ),
  shell(
    'Bookmark transaction is verified and cleaned up',
    'Phase 6',
    `${
      bullets(
        [
          `Created and found bookmark ${checks['bookmark-create-verify-confirm-cleanup'].bookmark_id}`,
          `R3 confirmation ${checks['bookmark-create-verify-confirm-cleanup'].confirmation_id}`,
          'Approved exact operation, removed bookmark, searched again',
          `Cleanup and tab/window shutdown passed · ${evidence.checks.length}/${evidence.checks.length} checks`
        ],
        92,
        226
      )
    }${
      line('Evidence is redacted: URLs omit credentials, query strings, and fragments.', 92, 510, {
        fill: '#a8bbc1',
        size: 20
      })
    }`
  )
]

const run = (command, args) =>
  new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let stderr = ''
    child.stderr.on('data', chunk => {
      stderr += chunk.toString()
    })
    child.once('exit', code =>
      code === 0 ? resolveRun(undefined) : rejectRun(new Error(`${command} exited ${code}: ${stderr}`)))
  })

for (const [index, svg] of slides.entries()) {
  const stem = `frame-${String(index + 1).padStart(2, '0')}`
  const svgPath = join(outDir, `${stem}.svg`)
  await writeFile(svgPath, svg)
  await run('sips', ['-s', 'format', 'png', svgPath, '--out', join(outDir, `${stem}.png`)])
}

const videoPath = join(outDir, 'oneworks-external-browser-control.mp4')
const ffmpeg = spawn('ffmpeg', [
  '-y',
  '-hide_banner',
  '-loglevel',
  'error',
  '-framerate',
  '1/4',
  '-i',
  join(outDir, 'frame-%02d.png'),
  '-vf',
  'fps=30,format=yuv420p',
  '-c:v',
  'libx264',
  '-preset',
  'medium',
  '-movflags',
  '+faststart',
  videoPath
], { stdio: ['ignore', 'pipe', 'pipe'] })
let stderr = ''
ffmpeg.stderr.on('data', chunk => {
  stderr += chunk.toString()
})
const exitCode = await new Promise(resolveExit => ffmpeg.once('exit', resolveExit))
if (exitCode !== 0) throw new Error(`ffmpeg failed with exit code ${exitCode}: ${stderr}`)
process.stdout.write(`${JSON.stringify({ slides: slides.length, video: videoPath })}\n`)
