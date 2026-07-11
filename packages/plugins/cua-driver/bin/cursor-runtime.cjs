/* eslint-disable max-lines -- session styling and its cross-process transaction form one safety boundary. */
const { createHash, randomUUID } = require('node:crypto')
const { constants } = require('node:fs')
const { mkdir, open, writeFile } = require('node:fs/promises')
const { createServer } = require('node:net')
const { homedir } = require('node:os')
const { join } = require('node:path')
const process = require('node:process')

const pointerActionTools = new Set(['click', 'double_click', 'right_click'])
const directGlideMotion = Object.freeze({
  dwell_after_click_ms: 125,
  glide_duration_ms: 180,
  // A cursor belongs to the live MCP session and is removed when that session
  // ends, so hiding it between actions only creates distracting flicker.
  idle_hide_ms: 0,
  // Upstream uses a Dubins planner. Its minimum allowed radius makes the
  // mandatory entry/exit turns effectively straight instead of wide loops.
  turn_radius: 1
})
const defaultSilver = '#E3E7ED'
const defaultCursorDir = join(homedir(), 'Library', 'Caches', 'oneworks-cua', 'session-cursors')
const defaultLockHost = '127.0.0.1'
const cursorAssetVersion = 'up-v3'
const defaultLockPort = 49_152 + (
  createHash('sha256')
    .update(`${homedir()}:${process.getuid?.() ?? 'unknown'}:oneworks-cua-cursor-lock`)
    .digest()
    .readUInt16BE(0) % 16_384
)
const cursorPathData = 'M55.87 28.26C60.04 30.56 60.04 33.44 55.87 35.74L18.38 56.42C14.56 58.53 10.45 54.55 12.42 50.66L21.18 33.38C21.62 32.51 21.62 31.49 21.18 30.62L12.42 13.34C10.45 9.45 14.56 5.47 18.38 7.58L55.87 28.26Z'

const delay = milliseconds => new Promise(resolveDelay => setTimeout(resolveDelay, milliseconds))

function normalizeCursorColor(value) {
  if (typeof value !== 'string') return undefined
  const normalized = value.trim().toUpperCase()
  if (/^#[0-9A-F]{6}$/.test(normalized)) return normalized
  const short = normalized.match(/^#([0-9A-F])([0-9A-F])([0-9A-F])$/)
  return short == null ? undefined : `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`
}

function hslToHex(hue, saturation = 72, lightness = 52) {
  const s = saturation / 100
  const l = lightness / 100
  const chroma = (1 - Math.abs((2 * l) - 1)) * s
  const section = ((hue % 360) + 360) % 360 / 60
  const secondary = chroma * (1 - Math.abs((section % 2) - 1))
  const offset = l - (chroma / 2)
  const [red, green, blue] = section < 1 ? [chroma, secondary, 0]
    : section < 2 ? [secondary, chroma, 0]
    : section < 3 ? [0, chroma, secondary]
    : section < 4 ? [0, secondary, chroma]
    : section < 5 ? [secondary, 0, chroma]
    : [chroma, 0, secondary]
  return `#${[red, green, blue].map(channel => (
    Math.round((channel + offset) * 255).toString(16).padStart(2, '0')
  )).join('').toUpperCase()}`
}

function deriveSessionCursorColor(sessionId) {
  const digest = createHash('sha256').update(String(sessionId ?? '')).digest()
  return hslToHex(
    digest.readUInt16BE(0) % 360,
    66 + (digest[2] % 20),
    44 + (digest[3] % 14)
  )
}

function resolveInitialCursorColor({ defaultColor, sessionId, strategy }) {
  const fallback = normalizeCursorColor(defaultColor) ?? defaultSilver
  return strategy === 'fixed' ? fallback : deriveSessionCursorColor(sessionId)
}

function cursorBorderColor(fillColor) {
  const color = normalizeCursorColor(fillColor) ?? defaultSilver
  const red = Number.parseInt(color.slice(1, 3), 16)
  const green = Number.parseInt(color.slice(3, 5), 16)
  const blue = Number.parseInt(color.slice(5, 7), 16)
  const luminance = ((0.2126 * red) + (0.7152 * green) + (0.0722 * blue)) / 255
  return luminance > 0.68 ? '#596273' : '#FFFFFF'
}

function renderCursorSvg(fillColor) {
  const color = normalizeCursorColor(fillColor)
  if (color == null) throw new TypeError('Cursor color must be a CSS hex color such as #625BF6.')
  const borderColor = cursorBorderColor(color)
  // CUA treats custom cursor assets as intrinsically pointing up and applies
  // its heading transform from that basis. The authored path points right, so
  // rotate only the asset basis; the final rendered silhouette is unchanged.
  return `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 64 64" fill="none">\n  <g transform="rotate(-90 32 32)">\n    <path fill="${color}" stroke="${borderColor}" stroke-width="2.5" stroke-linejoin="round" d="${cursorPathData}"/>\n  </g>\n</svg>\n`
}

async function materializeCursorSvg({ color, cursorDir = defaultCursorDir, sessionId }) {
  const normalizedColor = normalizeCursorColor(color)
  if (normalizedColor == null) throw new TypeError('Cursor color must be a CSS hex color such as #625BF6.')
  const sessionKey = createHash('sha256').update(String(sessionId ?? '')).digest('hex').slice(0, 12)
  const fileStem = `cursor-${cursorAssetVersion}-${sessionKey}-${normalizedColor.slice(1).toLowerCase()}`
  const imagePath = join(cursorDir, `${fileStem}.svg`)
  const expectedSvg = renderCursorSvg(normalizedColor)
  await mkdir(cursorDir, { recursive: true, mode: 0o700 })
  try {
    await writeFile(imagePath, expectedSvg, { encoding: 'utf8', flag: 'wx', mode: 0o600 })
    return imagePath
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error
  }

  let existingHandle
  try {
    existingHandle = await open(imagePath, constants.O_RDONLY | constants.O_NOFOLLOW)
    const existingStat = await existingHandle.stat()
    const existingSvg = await existingHandle.readFile('utf8')
    if (existingStat.isFile() && existingSvg === expectedSvg) return imagePath
  } catch {
    // A conflicting file is never reused; a new unpredictable path is generated below.
  } finally {
    await existingHandle?.close().catch(() => undefined)
  }

  const uniquePath = join(cursorDir, `${fileStem}-${randomUUID()}.svg`)
  await writeFile(uniquePath, expectedSvg, { encoding: 'utf8', flag: 'wx', mode: 0o600 })
  return uniquePath
}

const tryAcquireCursorPort = (host, port) => new Promise((resolveAcquire, rejectAcquire) => {
  const server = createServer(socket => socket.destroy())
  let settled = false
  server.once('error', error => {
    if (settled) return
    settled = true
    if (error?.code === 'EADDRINUSE') resolveAcquire(undefined)
    else rejectAcquire(error)
  })
  server.listen({ exclusive: true, host, port }, () => {
    if (settled) return
    settled = true
    resolveAcquire(server)
  })
})

const closeCursorPort = server => new Promise(resolveClose => {
  server.close(() => resolveClose())
})

async function withCursorActionLock(task, options = {}) {
  const host = options.lockHost ?? defaultLockHost
  const port = options.lockPort ?? defaultLockPort
  const timeoutMs = options.timeoutMs ?? 140_000
  const startedAt = Date.now()

  let server
  while (server == null) {
    server = await tryAcquireCursorPort(host, port)
    if (server == null) {
      if (Date.now() - startedAt >= timeoutMs) {
        const timeoutError = new Error('Timed out waiting for another CUA session to finish its pointer action.')
        timeoutError.code = 'CURSOR_ACTION_LOCK_TIMEOUT'
        throw timeoutError
      }
      await delay(25)
    }
  }

  try {
    return await task()
  } finally {
    await closeCursorPort(server)
  }
}

function createSessionCursorController(options) {
  const sessionId = options.sessionId ?? `process-${process.pid}`
  let color = resolveInitialCursorColor({
    defaultColor: options.defaultColor,
    sessionId,
    strategy: options.strategy
  })
  let source = options.strategy === 'fixed' ? 'default' : 'automatic'
  const lock = options.withLock ?? withCursorActionLock
  let motionReady = false

  return {
    getState() {
      return { color, sessionId, source }
    },
    setColor(nextColor) {
      const normalized = normalizeCursorColor(nextColor)
      if (normalized == null) throw new TypeError('Cursor color must be a CSS hex color such as #625BF6.')
      color = normalized
      source = 'agent'
      return { color, sessionId, source }
    },
    async callTool(name, args) {
      if (!pointerActionTools.has(name)) return await options.callTool(name, args)
      return await lock(async () => {
        if (!motionReady) {
          await options.callTool('set_agent_cursor_motion', directGlideMotion)
          motionReady = true
        }
        const imagePath = await materializeCursorSvg({
          color,
          cursorDir: options.cursorDir,
          sessionId
        })
        await options.callTool('set_agent_cursor_style', {
          bloom_color: color,
          image_path: imagePath
        })
        return await options.callTool(name, args)
      }, options.lockOptions)
    }
  }
}

const sessionCursorToolDefinition = {
  name: 'set_session_cursor_color',
  description: 'Set the visual Agent pointer color for this OneWorks session. Use this when the user requests a specific color or needs concurrent CUA sessions to be visually distinguishable. The plugin validates the color, generates a safe rounded SVG with a contrasting border, and applies it only immediately before this session performs pointer actions.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['color'],
    properties: {
      color: {
        type: 'string',
        pattern: '^#[0-9A-Fa-f]{3}(?:[0-9A-Fa-f]{3})?$',
        description: 'CSS hex color, for example #625BF6.'
      }
    }
  }
}

function sessionCursorToolResult(state) {
  return {
    content: [{ type: 'text', text: `Session pointer color set to ${state.color}.` }],
    structuredContent: {
      color: state.color,
      source: state.source
    }
  }
}

module.exports = {
  createSessionCursorController,
  cursorBorderColor,
  deriveSessionCursorColor,
  directGlideMotion,
  materializeCursorSvg,
  normalizeCursorColor,
  pointerActionTools,
  renderCursorSvg,
  resolveInitialCursorColor,
  sessionCursorToolDefinition,
  sessionCursorToolResult,
  withCursorActionLock
}
