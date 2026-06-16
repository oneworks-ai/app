/* eslint-disable max-lines -- CDP recording keeps Chrome lifecycle, frame capture, and ffmpeg encoding together. */
import { Buffer } from 'node:buffer'
import { spawn } from 'node:child_process'
import { constants } from 'node:fs'
import { access, copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import process from 'node:process'

import type {
  DemoVideoClickOptions,
  DemoVideoColorScheme,
  DemoVideoKeyOptions,
  DemoVideoRecordOptions,
  DemoVideoRecordResult,
  DemoVideoScenario,
  DemoVideoScenarioContext,
  DemoVideoTextOptions,
  DemoVideoTypeOptions,
  DemoVideoViewport
} from './types'

interface ChromeDebugTarget {
  type: string
  url: string
  webSocketDebuggerUrl?: string
}

interface ChromeLaunch {
  close: () => Promise<void>
  port: number
}

interface CdpPendingRequest {
  reject: (reason: Error) => void
  resolve: (value: unknown) => void
}

interface CdpProtocolError {
  code?: number
  message?: string
}

interface RuntimeEvaluateResponse {
  exceptionDetails?: {
    exception?: {
      description?: string
    }
    text?: string
  }
  result?: {
    value?: unknown
  }
}

interface PageCaptureScreenshotResponse {
  data?: string
}

interface Point {
  x: number
  y: number
}

interface KeyDefinition {
  code: string
  display: string
  key: string
  windowsVirtualKeyCode: number
  text?: string
}

interface ModifierKeyDefinition extends KeyDefinition {
  modifierBit: number
}

interface ParsedKeyCombo {
  displayLabels: string[]
  key: KeyDefinition
  modifiers: ModifierKeyDefinition[]
}

const DEFAULT_COLOR_SCHEME: DemoVideoColorScheme = 'light'
const DEFAULT_OUTPUT_ROOT = '.logs/demo-videos'
const DEFAULT_CHROME_TIMEOUT_MS = 15_000
const DEFAULT_ACTION_TIMEOUT_MS = 10_000

const modifierKeyDefinitions: Record<string, ModifierKeyDefinition> = {
  alt: {
    code: 'AltLeft',
    display: 'Alt',
    key: 'Alt',
    modifierBit: 1,
    windowsVirtualKeyCode: 18
  },
  control: {
    code: 'ControlLeft',
    display: 'Ctrl',
    key: 'Control',
    modifierBit: 2,
    windowsVirtualKeyCode: 17
  },
  meta: {
    code: 'MetaLeft',
    display: '⌘',
    key: 'Meta',
    modifierBit: 4,
    windowsVirtualKeyCode: 91
  },
  shift: {
    code: 'ShiftLeft',
    display: 'Shift',
    key: 'Shift',
    modifierBit: 8,
    windowsVirtualKeyCode: 16
  }
}

const modifierAliases: Record<string, keyof typeof modifierKeyDefinitions> = {
  alt: 'alt',
  cmd: 'meta',
  command: 'meta',
  control: 'control',
  ctrl: 'control',
  meta: 'meta',
  option: 'alt',
  shift: 'shift'
}

const specialKeyDefinitions: Record<string, KeyDefinition> = {
  arrowdown: {
    code: 'ArrowDown',
    display: '↓',
    key: 'ArrowDown',
    windowsVirtualKeyCode: 40
  },
  arrowleft: {
    code: 'ArrowLeft',
    display: '←',
    key: 'ArrowLeft',
    windowsVirtualKeyCode: 37
  },
  arrowright: {
    code: 'ArrowRight',
    display: '→',
    key: 'ArrowRight',
    windowsVirtualKeyCode: 39
  },
  arrowup: {
    code: 'ArrowUp',
    display: '↑',
    key: 'ArrowUp',
    windowsVirtualKeyCode: 38
  },
  backspace: {
    code: 'Backspace',
    display: 'Backspace',
    key: 'Backspace',
    windowsVirtualKeyCode: 8
  },
  delete: {
    code: 'Delete',
    display: 'Delete',
    key: 'Delete',
    windowsVirtualKeyCode: 46
  },
  enter: {
    code: 'Enter',
    display: 'Enter',
    key: 'Enter',
    text: '\r',
    windowsVirtualKeyCode: 13
  },
  escape: {
    code: 'Escape',
    display: 'Esc',
    key: 'Escape',
    windowsVirtualKeyCode: 27
  },
  space: {
    code: 'Space',
    display: 'Space',
    key: ' ',
    text: ' ',
    windowsVirtualKeyCode: 32
  },
  tab: {
    code: 'Tab',
    display: 'Tab',
    key: 'Tab',
    windowsVirtualKeyCode: 9
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> => (
  value != null && typeof value === 'object' && !Array.isArray(value)
)

const isNonEmptyString = (value: unknown): value is string => (
  typeof value === 'string' && value.trim() !== ''
)

const sleep = async (ms: number) =>
  await new Promise<void>((resolve) => {
    setTimeout(resolve, ms)
  })

const sanitizeFileSegment = (value: string) => {
  const sanitized = value.trim().replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '')
  return sanitized === '' ? 'demo-video' : sanitized
}

const normalizeKeyToken = (value: string) => value.trim().toLowerCase().replace(/[\s_-]+/g, '')

const createPrintableKeyDefinition = (value: string): KeyDefinition => {
  if (/^[a-z]$/i.test(value)) {
    const upper = value.toUpperCase()
    const lower = value.toLowerCase()
    return {
      code: `Key${upper}`,
      display: upper,
      key: lower,
      text: lower,
      windowsVirtualKeyCode: upper.charCodeAt(0)
    }
  }

  if (/^\d$/.test(value)) {
    return {
      code: `Digit${value}`,
      display: value,
      key: value,
      text: value,
      windowsVirtualKeyCode: value.charCodeAt(0)
    }
  }

  if (value.length === 1) {
    return {
      code: value,
      display: value,
      key: value,
      text: value,
      windowsVirtualKeyCode: value.toUpperCase().charCodeAt(0)
    }
  }

  throw new Error(`Unsupported demo video key: ${value}`)
}

const parseKeyDefinition = (value: string): KeyDefinition => {
  const normalized = normalizeKeyToken(value)
  return specialKeyDefinitions[normalized] ?? createPrintableKeyDefinition(value)
}

const parseKeyCombo = (value: string): ParsedKeyCombo => {
  const parts = value.split('+').map(part => part.trim()).filter(part => part !== '')
  if (parts.length === 0) throw new Error('A key value is required.')

  const keyPart = parts.at(-1)
  if (keyPart == null) throw new Error('A key value is required.')
  const modifiers = parts.slice(0, -1).map((part) => {
    const alias = modifierAliases[normalizeKeyToken(part)]
    if (alias == null) throw new Error(`Unsupported demo video modifier key: ${part}`)
    return modifierKeyDefinitions[alias]
  })
  const key = parseKeyDefinition(keyPart)

  return {
    displayLabels: modifiers.map(modifier => modifier.display).concat(key.display),
    key,
    modifiers
  }
}

const formatTypedText = (value: string) => {
  const normalized = value.replace(/\s+/g, ' ').trim()
  if (normalized === '') return 'empty text'
  return normalized.length <= 24 ? `"${normalized}"` : `"${normalized.slice(0, 21)}..."`
}

const resolveOutputPaths = (input: {
  name?: string
  outDir?: string
  scenarioId: string
}) => {
  const outputName = sanitizeFileSegment(input.name ?? input.scenarioId)
  const outDir = path.resolve(process.cwd(), input.outDir ?? path.join(DEFAULT_OUTPUT_ROOT, input.scenarioId))
  return {
    framesDir: path.join(outDir, 'frames'),
    outDir,
    posterPath: path.join(outDir, `${outputName}-poster.png`),
    videoPath: path.join(outDir, `${outputName}.mp4`)
  }
}

const frameFileName = (index: number) => `frame_${String(index).padStart(5, '0')}.png`

const commandExists = async (command: string) =>
  await new Promise<string | undefined>((resolve) => {
    const child = spawn('which', [command], {
      stdio: ['ignore', 'pipe', 'ignore']
    })
    const chunks: Buffer[] = []
    child.stdout.on('data', (chunk: Buffer) => chunks.push(chunk))
    child.once('error', () => resolve(undefined))
    child.once('close', code => {
      if (code !== 0) {
        resolve(undefined)
        return
      }
      const resolved = Buffer.concat(chunks).toString('utf8').trim()
      resolve(resolved === '' ? undefined : resolved)
    })
  })

const canExecute = async (filePath: string) => {
  try {
    await access(filePath, constants.X_OK)
    return true
  } catch {
    return false
  }
}

const resolveChromePath = async (explicitPath?: string) => {
  if (isNonEmptyString(explicitPath)) {
    if (await canExecute(explicitPath)) return explicitPath
    throw new Error(`Chrome executable is not available or not executable: ${explicitPath}`)
  }

  const envPath = process.env.CHROME_PATH ?? process.env.GOOGLE_CHROME_SHIM
  if (isNonEmptyString(envPath) && await canExecute(envPath)) return envPath

  const fileCandidates = process.platform === 'darwin'
    ? [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
      path.join(process.env.HOME ?? '', 'Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
    ]
    : []
  for (const candidate of fileCandidates) {
    if (candidate !== '' && await canExecute(candidate)) return candidate
  }

  const commandCandidates = process.platform === 'win32'
    ? ['chrome', 'chrome.exe']
    : ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser']
  for (const candidate of commandCandidates) {
    const commandPath = await commandExists(candidate)
    if (commandPath != null) return commandPath
  }

  throw new Error('Unable to find Chrome. Set CHROME_PATH or pass --chrome-path.')
}

const getFreePort = async () =>
  await new Promise<number>((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (address == null || typeof address === 'string') {
        server.close(() => reject(new Error('Failed to allocate a local port.')))
        return
      }
      const port = address.port
      server.close(() => resolve(port))
    })
  })

const fetchJson = async (url: string, init?: RequestInit) => {
  const response = await fetch(url, init)
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} while loading ${url}`)
  }
  return await response.json() as unknown
}

const parseChromeTargets = (value: unknown): ChromeDebugTarget[] => {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    if (!isRecord(item)) return []
    const type = item.type
    const url = item.url
    const webSocketDebuggerUrl = item.webSocketDebuggerUrl
    if (!isNonEmptyString(type) || !isNonEmptyString(url)) return []
    return [{
      type,
      url,
      webSocketDebuggerUrl: isNonEmptyString(webSocketDebuggerUrl) ? webSocketDebuggerUrl : undefined
    }]
  })
}

const waitForChrome = async (input: {
  port: number
  stderrChunks: Buffer[]
  timeoutMs: number
}) => {
  const startedAt = Date.now()
  while (Date.now() - startedAt < input.timeoutMs) {
    try {
      const targets = parseChromeTargets(await fetchJson(`http://127.0.0.1:${input.port}/json/list`))
      const page = targets.find(target => target.type === 'page' && target.webSocketDebuggerUrl != null)
      if (page?.webSocketDebuggerUrl != null) return page.webSocketDebuggerUrl
    } catch {
    }
    await sleep(100)
  }

  const stderr = Buffer.concat(input.stderrChunks).toString('utf8').trim()
  throw new Error(
    [
      `Timed out waiting for Chrome DevTools on port ${input.port}.`,
      stderr === '' ? undefined : `Chrome stderr:\n${stderr}`
    ].filter(Boolean).join('\n')
  )
}

const launchChrome = async (input: {
  chromePath?: string
  viewport: DemoVideoViewport
}): Promise<ChromeLaunch & { webSocketDebuggerUrl: string }> => {
  const chromePath = await resolveChromePath(input.chromePath)
  const port = await getFreePort()
  const userDataDir = await mkdtemp(path.join(tmpdir(), 'oneworks-demo-video-chrome-'))
  const stderrChunks: Buffer[] = []
  const child = spawn(chromePath, [
    '--headless=new',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-networking',
    '--disable-dev-shm-usage',
    '--disable-gpu',
    '--no-sandbox',
    '--allow-insecure-localhost',
    '--force-device-scale-factor=1',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataDir}`,
    `--window-size=${input.viewport.width},${input.viewport.height}`,
    'about:blank'
  ], {
    stdio: ['ignore', 'ignore', 'pipe']
  })

  child.stderr.on('data', (chunk: Buffer) => stderrChunks.push(chunk))

  const close = async () => {
    if (child.exitCode == null && child.signalCode == null) {
      child.kill('SIGTERM')
      await Promise.race([
        new Promise<void>(resolve => child.once('close', () => resolve())),
        sleep(3_000).then(() => {
          if (child.exitCode == null && child.signalCode == null) child.kill('SIGKILL')
        })
      ])
    }
    await rm(userDataDir, { force: true, recursive: true })
  }

  try {
    const webSocketDebuggerUrl = await Promise.race([
      waitForChrome({
        port,
        stderrChunks,
        timeoutMs: DEFAULT_CHROME_TIMEOUT_MS
      }),
      new Promise<never>((_resolve, reject) => {
        child.once('error', reject)
      })
    ])
    return {
      close,
      port,
      webSocketDebuggerUrl
    }
  } catch (error) {
    await close()
    throw error
  }
}

const stringifyWebSocketMessage = (value: string | ArrayBuffer | Blob | ArrayBufferView) => {
  if (typeof value === 'string') return value
  if (value instanceof ArrayBuffer) return Buffer.from(value).toString('utf8')
  if (ArrayBuffer.isView(value)) return Buffer.from(value.buffer, value.byteOffset, value.byteLength).toString('utf8')
  throw new TypeError('Unsupported WebSocket payload type')
}

const createCdpClient = async (webSocketDebuggerUrl: string) => {
  const socket = new WebSocket(webSocketDebuggerUrl)
  let nextId = 0
  let isClosed = false
  const pending = new Map<number, CdpPendingRequest>()

  const rejectPending = (message: string) => {
    for (const request of pending.values()) {
      request.reject(new Error(message))
    }
    pending.clear()
  }

  await new Promise<void>((resolve, reject) => {
    const handleOpen = () => {
      socket.removeEventListener('error', handleError)
      resolve()
    }
    const handleError = () => {
      socket.removeEventListener('open', handleOpen)
      reject(new Error(`Failed to connect to Chrome DevTools: ${webSocketDebuggerUrl}`))
    }

    socket.addEventListener('open', handleOpen, { once: true })
    socket.addEventListener('error', handleError, { once: true })
  })

  socket.addEventListener('message', (event) => {
    let parsed: unknown
    try {
      parsed = JSON.parse(stringifyWebSocketMessage(event.data))
    } catch (error) {
      rejectPending(error instanceof Error ? error.message : String(error))
      return
    }

    if (!isRecord(parsed) || typeof parsed.id !== 'number') return
    const request = pending.get(parsed.id)
    if (request == null) return
    pending.delete(parsed.id)

    if (isRecord(parsed.error)) {
      const errorInfo = parsed.error as CdpProtocolError
      request.reject(
        new Error(`Chrome DevTools error ${errorInfo.code ?? 'unknown'}: ${errorInfo.message ?? 'unknown error'}`)
      )
      return
    }

    request.resolve(parsed.result)
  })

  socket.addEventListener('close', () => {
    isClosed = true
    rejectPending('Chrome DevTools connection closed unexpectedly.')
  })

  return {
    close() {
      if (isClosed) return
      isClosed = true
      socket.close()
      rejectPending('Chrome DevTools connection closed.')
    },
    async send<TResult>(method: string, params?: Record<string, unknown>) {
      if (isClosed) throw new Error('Chrome DevTools connection is already closed.')
      const id = ++nextId
      const resultPromise = new Promise<TResult>((resolve, reject) => {
        pending.set(id, {
          reject,
          resolve: value => resolve(value as TResult | PromiseLike<TResult>)
        })
      })
      socket.send(JSON.stringify({
        id,
        method,
        params: params ?? {}
      }))
      return await resultPromise
    }
  }
}

type CdpClient = Awaited<ReturnType<typeof createCdpClient>>

const runCommand = async (input: {
  args: string[]
  command: string
  cwd: string
  timeoutMs: number
}) => {
  const child = spawn(input.command, input.args, {
    cwd: input.cwd,
    stdio: ['ignore', 'pipe', 'pipe']
  })
  const stdoutChunks: Buffer[] = []
  const stderrChunks: Buffer[] = []
  let timedOut = false

  child.stdout.on('data', (chunk: Buffer) => stdoutChunks.push(chunk))
  child.stderr.on('data', (chunk: Buffer) => stderrChunks.push(chunk))

  const timeout = setTimeout(() => {
    timedOut = true
    child.kill('SIGTERM')
  }, input.timeoutMs)

  return await new Promise<{
    code: number
    stderr: string
    stdout: string
    timedOut: boolean
  }>((resolve, reject) => {
    child.once('error', reject)
    child.once('close', code => {
      clearTimeout(timeout)
      resolve({
        code: code ?? (timedOut ? -1 : 0),
        stderr: Buffer.concat(stderrChunks).toString('utf8'),
        stdout: Buffer.concat(stdoutChunks).toString('utf8'),
        timedOut
      })
    })
  })
}

const findPointByTextExpression = (input: {
  exact: boolean
  text: string
}) => `
(() => {
  const targetText = ${JSON.stringify(input.text)};
  const exact = ${JSON.stringify(input.exact)};
  const normalize = (value) => String(value ?? '').replace(/\\s+/g, ' ').trim();
  const isVisible = (element) => {
    if (!(element instanceof Element)) return false;
    const style = window.getComputedStyle(element);
    if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false;
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  };
  const scoreElement = (element, rect) => {
    const tag = element.tagName.toLowerCase();
    const role = element.getAttribute('role') ?? '';
    const interactive = tag === 'button' || tag === 'a' || role === 'button' || role === 'tab' ? 0 : 1000000;
    return interactive + rect.width * rect.height;
  };
  const candidates = [...document.querySelectorAll('button, a, [role="button"], [role="tab"], input, textarea, select, th, td, span, div, label')]
    .flatMap((element) => {
      if (!isVisible(element)) return [];
      const text = normalize(element.innerText || element.textContent);
      if (text === '') return [];
      const matched = exact ? text === targetText : text.includes(targetText);
      if (!matched) return [];
      const rect = element.getBoundingClientRect();
      return [{
        score: scoreElement(element, rect),
        x: rect.x + rect.width / 2,
        y: rect.y + rect.height / 2
      }];
    })
    .sort((a, b) => a.score - b.score);
  return candidates[0] ?? null;
})()
`

const findPointBySelectorExpression = (selector: string) => `
(() => {
  const element = document.querySelector(${JSON.stringify(selector)});
  if (!(element instanceof Element)) return null;
  const rect = element.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return null;
  return {
    x: rect.x + rect.width / 2,
    y: rect.y + rect.height / 2
  };
})()
`

const installOverlayExpression = `
(() => {
  const cursorId = '__oneworks_demo_video_cursor';
  const keyboardId = '__oneworks_demo_video_keyboard';
  let cursor = document.getElementById(cursorId);
  if (cursor == null) {
    cursor = document.createElement('div');
    cursor.id = cursorId;
    cursor.setAttribute('aria-hidden', 'true');
    cursor.style.position = 'fixed';
    cursor.style.zIndex = '2147483647';
    cursor.style.width = '18px';
    cursor.style.height = '18px';
    cursor.style.border = '2px solid #ffffff';
    cursor.style.borderRadius = '999px';
    cursor.style.background = '#1677ff';
    cursor.style.boxShadow = '0 0 0 4px rgba(22, 119, 255, 0.24), 0 6px 18px rgba(15, 23, 42, 0.3)';
    cursor.style.pointerEvents = 'none';
    cursor.style.transform = 'translate(-50%, -50%)';
    cursor.style.transition = 'left 160ms ease, top 160ms ease, opacity 120ms ease, transform 120ms ease';
    cursor.style.opacity = '0';
    document.documentElement.appendChild(cursor);
  }
  let keyboard = document.getElementById(keyboardId);
  if (keyboard == null) {
    keyboard = document.createElement('div');
    keyboard.id = keyboardId;
    keyboard.setAttribute('aria-hidden', 'true');
    keyboard.style.position = 'fixed';
    keyboard.style.left = '50%';
    keyboard.style.bottom = '28px';
    keyboard.style.zIndex = '2147483647';
    keyboard.style.display = 'flex';
    keyboard.style.alignItems = 'center';
    keyboard.style.justifyContent = 'center';
    keyboard.style.gap = '8px';
    keyboard.style.maxWidth = 'calc(100vw - 48px)';
    keyboard.style.pointerEvents = 'none';
    keyboard.style.transform = 'translateX(-50%)';
    keyboard.style.transition = 'opacity 160ms ease, transform 160ms ease';
    keyboard.style.opacity = '0';
    document.documentElement.appendChild(keyboard);
  }
  const buildKey = (label) => {
    const key = document.createElement('kbd');
    key.textContent = String(label);
    key.style.display = 'inline-flex';
    key.style.alignItems = 'center';
    key.style.justifyContent = 'center';
    key.style.minWidth = '34px';
    key.style.minHeight = '28px';
    key.style.padding = '3px 10px';
    key.style.border = '1px solid rgba(255, 255, 255, 0.72)';
    key.style.borderRadius = '7px';
    key.style.background = 'rgba(15, 23, 42, 0.88)';
    key.style.boxShadow = '0 10px 24px rgba(15, 23, 42, 0.32)';
    key.style.color = '#ffffff';
    key.style.font = '700 13px/1.1 ui-sans-serif, system-ui, sans-serif';
    key.style.letterSpacing = '0';
    return key;
  };
  window.__oneworksDemoVideoSetCursor = (x, y, visible = true, pressed = false) => {
    cursor.style.left = String(x) + 'px';
    cursor.style.top = String(y) + 'px';
    cursor.style.opacity = visible ? '1' : '0';
    cursor.style.transform = pressed ? 'translate(-50%, -50%) scale(0.72)' : 'translate(-50%, -50%)';
  };
  window.__oneworksDemoVideoShowKeys = (labels) => {
    keyboard.replaceChildren(...labels.map(buildKey));
    keyboard.style.opacity = '1';
    keyboard.style.transform = 'translateX(-50%) translateY(0)';
    if (window.__oneworksDemoVideoKeyboardTimer != null) {
      clearTimeout(window.__oneworksDemoVideoKeyboardTimer);
    }
    window.__oneworksDemoVideoKeyboardTimer = setTimeout(() => {
      keyboard.style.opacity = '0';
      keyboard.style.transform = 'translateX(-50%) translateY(6px)';
    }, 1200);
  };
})()
`

const setCursorExpression = (point: Point, pressed = false) => `
(() => {
  if (typeof window.__oneworksDemoVideoSetCursor === 'function') {
    window.__oneworksDemoVideoSetCursor(${JSON.stringify(point.x)}, ${JSON.stringify(point.y)}, true, ${
  JSON.stringify(pressed)
});
  }
})()
`

const showKeysExpression = (labels: string[]) => `
(() => {
  if (typeof window.__oneworksDemoVideoShowKeys === 'function') {
    window.__oneworksDemoVideoShowKeys(${JSON.stringify(labels)});
  }
})()
`

class DemoVideoRecorder implements DemoVideoScenarioContext {
  readonly durationMs: number
  readonly url: string | undefined

  private frameCount = 0

  constructor(
    private readonly client: CdpClient,
    private readonly input: {
      colorScheme: DemoVideoColorScheme
      durationMs: number
      fps: number
      framesDir: string
      height: number
      url?: string
      width: number
    }
  ) {
    this.durationMs = input.durationMs
    this.url = input.url
  }

  getFrameCount() {
    return this.frameCount
  }

  async initialize() {
    await this.client.send('Page.enable')
    await this.client.send('Runtime.enable')
    await this.client.send('Emulation.setDeviceMetricsOverride', {
      deviceScaleFactor: 1,
      height: this.input.height,
      mobile: false,
      width: this.input.width
    })
    if (this.input.colorScheme !== 'system') {
      await this.client.send('Emulation.setEmulatedMedia', {
        features: [{
          name: 'prefers-color-scheme',
          value: this.input.colorScheme
        }]
      })
    }
  }

  requireUrl() {
    if (!isNonEmptyString(this.url)) {
      throw new Error('This demo video scenario requires --url.')
    }
    return this.url
  }

  resolveUrl(pathname: string) {
    const baseUrl = this.requireUrl()
    if (/^https?:\/\//.test(pathname)) return pathname
    return new URL(pathname, baseUrl).toString()
  }

  async navigate(url: string) {
    await this.client.send('Page.navigate', { url })
    await this.waitForReadyState()
    await this.evaluate(installOverlayExpression)
  }

  async recordFor(durationMs: number) {
    const intervalMs = 1_000 / this.input.fps
    const frameTotal = Math.max(1, Math.ceil(durationMs / intervalMs))
    for (let index = 0; index < frameTotal; index += 1) {
      await this.captureFrame()
      if (index < frameTotal - 1) await sleep(intervalMs)
    }
  }

  async waitForText(text: string, options: DemoVideoTextOptions = {}) {
    const timeoutMs = options.timeoutMs ?? DEFAULT_ACTION_TIMEOUT_MS
    await this.waitForPoint(() => this.findPointByText(text, options.exact ?? false), {
      label: `text "${text}"`,
      timeoutMs
    })
  }

  async clickText(text: string, options: DemoVideoClickOptions = {}) {
    const point = await this.waitForPoint(() => this.findPointByText(text, options.exact ?? false), {
      label: `text "${text}"`,
      timeoutMs: options.timeoutMs ?? DEFAULT_ACTION_TIMEOUT_MS
    })
    await this.clickPoint(point, options.settleMs)
  }

  async clickSelector(selector: string, options: DemoVideoClickOptions = {}) {
    const point = await this.waitForPoint(() => this.findPointBySelector(selector), {
      label: `selector "${selector}"`,
      timeoutMs: options.timeoutMs ?? DEFAULT_ACTION_TIMEOUT_MS
    })
    await this.clickPoint(point, options.settleMs)
  }

  async pressKey(key: string, options: DemoVideoKeyOptions = {}) {
    const parsed = parseKeyCombo(key)
    await this.showKeys(parsed.displayLabels)
    await this.recordFor(300)

    let modifiers = 0
    for (const modifier of parsed.modifiers) {
      modifiers |= modifier.modifierBit
      await this.dispatchKeyEvent(modifier, 'rawKeyDown', modifiers)
    }

    const includeText = modifiers === 0 && parsed.key.text != null
    await this.dispatchKeyEvent(parsed.key, 'keyDown', modifiers, includeText)
    await this.dispatchKeyEvent(parsed.key, 'keyUp', modifiers)

    for (const modifier of parsed.modifiers.toReversed()) {
      await this.dispatchKeyEvent(modifier, 'keyUp', modifiers)
      modifiers &= ~modifier.modifierBit
    }

    await sleep(options.settleMs ?? 500)
  }

  async typeText(text: string, options: DemoVideoTypeOptions = {}) {
    await this.showKeys(['Type', formatTypedText(text)])
    await this.recordFor(300)
    await this.client.send('Input.insertText', { text })
    await sleep(options.settleMs ?? 500)
  }

  private async waitForReadyState(timeoutMs = DEFAULT_ACTION_TIMEOUT_MS) {
    const startedAt = Date.now()
    while (Date.now() - startedAt < timeoutMs) {
      const readyState = await this.evaluate<string>('document.readyState')
      if (readyState === 'complete' || readyState === 'interactive') return
      await sleep(100)
    }
    throw new Error('Timed out waiting for page readiness.')
  }

  private async waitForPoint(
    findPoint: () => Promise<Point | undefined>,
    input: {
      label: string
      timeoutMs: number
    }
  ) {
    const startedAt = Date.now()
    while (Date.now() - startedAt < input.timeoutMs) {
      const point = await findPoint()
      if (point != null) return point
      await sleep(150)
    }
    throw new Error(`Timed out waiting for ${input.label}.`)
  }

  private async clickPoint(point: Point, settleMs = 500) {
    await this.evaluate(setCursorExpression(point))
    await this.recordFor(300)
    await this.client.send('Input.dispatchMouseEvent', {
      button: 'none',
      buttons: 0,
      type: 'mouseMoved',
      x: point.x,
      y: point.y
    })
    await this.client.send('Input.dispatchMouseEvent', {
      button: 'left',
      buttons: 1,
      clickCount: 1,
      type: 'mousePressed',
      x: point.x,
      y: point.y
    })
    await this.evaluate(setCursorExpression(point, true))
    await this.client.send('Input.dispatchMouseEvent', {
      button: 'left',
      buttons: 0,
      clickCount: 1,
      type: 'mouseReleased',
      x: point.x,
      y: point.y
    })
    await this.evaluate(setCursorExpression(point))
    await sleep(settleMs)
  }

  private async showKeys(labels: string[]) {
    await this.evaluate(showKeysExpression(labels))
  }

  private async dispatchKeyEvent(
    key: KeyDefinition,
    type: 'keyDown' | 'keyUp' | 'rawKeyDown',
    modifiers: number,
    includeText = false
  ) {
    await this.client.send('Input.dispatchKeyEvent', {
      code: key.code,
      key: key.key,
      modifiers,
      nativeVirtualKeyCode: key.windowsVirtualKeyCode,
      type,
      windowsVirtualKeyCode: key.windowsVirtualKeyCode,
      ...(includeText && key.text != null
        ? {
          text: key.text,
          unmodifiedText: key.text
        }
        : {})
    })
  }

  private async findPointByText(text: string, exact: boolean) {
    return await this.evaluatePoint(findPointByTextExpression({ exact, text }))
  }

  private async findPointBySelector(selector: string) {
    return await this.evaluatePoint(findPointBySelectorExpression(selector))
  }

  private async evaluatePoint(expression: string): Promise<Point | undefined> {
    const value = await this.evaluate<unknown>(expression)
    if (!isRecord(value)) return undefined
    const x = value.x
    const y = value.y
    if (typeof x !== 'number' || typeof y !== 'number') return undefined
    return { x, y }
  }

  private async evaluate<TResult>(expression: string) {
    const response = await this.client.send<RuntimeEvaluateResponse>('Runtime.evaluate', {
      awaitPromise: true,
      expression,
      returnByValue: true
    })
    if (response.exceptionDetails != null) {
      throw new Error(
        response.exceptionDetails.exception?.description ?? response.exceptionDetails.text ?? 'Runtime.evaluate failed.'
      )
    }
    return response.result?.value as TResult
  }

  private async captureFrame() {
    const response = await this.client.send<PageCaptureScreenshotResponse>('Page.captureScreenshot', {
      captureBeyondViewport: false,
      format: 'png'
    })
    if (!isNonEmptyString(response.data)) {
      throw new Error('Chrome returned an empty screenshot frame.')
    }
    this.frameCount += 1
    await writeFile(
      path.join(this.input.framesDir, frameFileName(this.frameCount)),
      Buffer.from(response.data, 'base64')
    )
  }
}

const encodeVideo = async (input: {
  ffmpegPath: string
  fps: number
  framesDir: string
  videoPath: string
}) => {
  const result = await runCommand({
    args: [
      '-y',
      '-framerate',
      String(input.fps),
      '-i',
      path.join(input.framesDir, 'frame_%05d.png'),
      '-vf',
      'scale=trunc(iw/2)*2:trunc(ih/2)*2',
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      '-movflags',
      '+faststart',
      input.videoPath
    ],
    command: input.ffmpegPath,
    cwd: process.cwd(),
    timeoutMs: 120_000
  })
  if (result.code !== 0) {
    throw new Error(
      [
        `ffmpeg failed with exit code ${result.code}.`,
        result.timedOut ? 'timedOut=true' : undefined,
        result.stdout.trim() === '' ? undefined : `stdout:\n${result.stdout}`,
        result.stderr.trim() === '' ? undefined : `stderr:\n${result.stderr}`
      ].filter(Boolean).join('\n')
    )
  }
}

export const recordDemoVideoScenario = async (
  scenario: DemoVideoScenario,
  options: DemoVideoRecordOptions
): Promise<DemoVideoRecordResult> => {
  const fps = options.fps ?? scenario.defaultFps
  const width = options.width ?? scenario.defaultViewport.width
  const height = options.height ?? scenario.defaultViewport.height
  const durationMs = options.durationMs ?? scenario.defaultDurationMs
  const colorScheme = options.colorScheme ?? DEFAULT_COLOR_SCHEME
  const outputPaths = resolveOutputPaths({
    name: options.name,
    outDir: options.outDir,
    scenarioId: scenario.id
  })
  const ffmpegPath = options.ffmpegPath ?? 'ffmpeg'

  await mkdir(outputPaths.outDir, { recursive: true })
  await rm(outputPaths.framesDir, { force: true, recursive: true })
  await rm(outputPaths.videoPath, { force: true })
  await rm(outputPaths.posterPath, { force: true })
  await mkdir(outputPaths.framesDir, { recursive: true })

  const chrome = await launchChrome({
    chromePath: options.chromePath,
    viewport: { height, width }
  })
  const client = await createCdpClient(chrome.webSocketDebuggerUrl)

  try {
    const recorder = new DemoVideoRecorder(client, {
      colorScheme,
      durationMs,
      fps,
      framesDir: outputPaths.framesDir,
      height,
      url: options.url,
      width
    })
    await recorder.initialize()
    await scenario.run(recorder)
    const frameCount = recorder.getFrameCount()
    if (frameCount <= 0) throw new Error(`Scenario "${scenario.id}" did not capture any frames.`)
    await copyFile(path.join(outputPaths.framesDir, frameFileName(1)), outputPaths.posterPath)
    await encodeVideo({
      ffmpegPath,
      fps,
      framesDir: outputPaths.framesDir,
      videoPath: outputPaths.videoPath
    })
    if (options.keepFrames !== true) {
      await rm(outputPaths.framesDir, { force: true, recursive: true })
    }
    return {
      colorScheme,
      durationMs: Math.round(frameCount / fps * 1_000),
      fps,
      frameCount,
      framesDir: outputPaths.framesDir,
      height,
      keptFrames: options.keepFrames === true,
      posterPath: outputPaths.posterPath,
      scenarioId: scenario.id,
      scenarioTitle: scenario.title,
      videoPath: outputPaths.videoPath,
      width
    }
  } finally {
    client.close()
    await chrome.close()
  }
}
