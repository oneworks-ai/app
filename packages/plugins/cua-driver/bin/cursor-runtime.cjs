/* eslint-disable max-lines -- session styling and its cross-process transaction form one safety boundary. */
const { createHash, randomUUID } = require('node:crypto')
const { constants } = require('node:fs')
const { mkdir, open, writeFile } = require('node:fs/promises')
const { createServer } = require('node:net')
const { homedir } = require('node:os')
const { join } = require('node:path')
const process = require('node:process')
const { createOneWorksCursorSvg } = require('@oneworks/cursor')

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

const delay = milliseconds => new Promise(resolveDelay => setTimeout(resolveDelay, milliseconds))

function normalizeCursorColor(value) {
  if (typeof value !== 'string') return undefined
  const normalized = value.trim().toUpperCase()
  if (/^#[0-9A-F]{6}$/.test(normalized)) return normalized
  const short = normalized.match(/^#([0-9A-F])([0-9A-F])([0-9A-F])$/)
  return short == null ? undefined : `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`
}

function normalizeCursorStart(value) {
  if (value == null) return undefined
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('Cursor start must contain logical screen coordinates x and y.')
  }
  const { x, y } = value
  if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0) {
    throw new TypeError('Cursor start x and y must be finite non-negative numbers in logical screen points.')
  }
  return { x, y }
}

function parseScreenSize(result) {
  const candidates = [result?.structuredContent, result]
  const text = result?.content?.find?.(item => item?.type === 'text')?.text
  if (typeof text === 'string') {
    try {
      candidates.push(JSON.parse(text))
    } catch {
      // Structured MCP content is preferred; invalid fallback text is ignored.
    }
  }
  const size = candidates.find(candidate => (
    Number.isFinite(candidate?.width) && candidate.width > 0 &&
    Number.isFinite(candidate?.height) && candidate.height > 0
  ))
  if (size == null) throw new Error('Cua Driver returned an invalid main-display size.')
  return { height: size.height, width: size.width }
}

async function resolveCursorStart(callTool, requestedStart) {
  const { height, width } = parseScreenSize(await callTool('get_screen_size', {}))
  const resolved = requestedStart ?? { x: width / 2, y: height / 2 }
  if (resolved.x >= width || resolved.y >= height) {
    throw new RangeError(
      `Cursor start (${resolved.x}, ${resolved.y}) is outside the main display (${width} × ${height}).`
    )
  }
  return resolved
}

function hslToHex(hue, saturation = 72, lightness = 52) {
  const s = saturation / 100
  const l = lightness / 100
  const chroma = (1 - Math.abs((2 * l) - 1)) * s
  const section = ((hue % 360) + 360) % 360 / 60
  const secondary = chroma * (1 - Math.abs((section % 2) - 1))
  const offset = l - (chroma / 2)
  const [red, green, blue] = section < 1
    ? [chroma, secondary, 0]
    : section < 2
    ? [secondary, chroma, 0]
    : section < 3
    ? [0, chroma, secondary]
    : section < 4
    ? [0, secondary, chroma]
    : section < 5
    ? [secondary, 0, chroma]
    : [chroma, 0, secondary]
  return `#${
    [red, green, blue].map(channel => (
      Math.round((channel + offset) * 255).toString(16).padStart(2, '0')
    )).join('').toUpperCase()
  }`
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

async function materializeCursorSvg({ color, cursorDir = defaultCursorDir, sessionId }) {
  const normalizedColor = normalizeCursorColor(color)
  if (normalizedColor == null) throw new TypeError('Cursor color must be a CSS hex color such as #625BF6.')
  const sessionKey = createHash('sha256').update(String(sessionId ?? '')).digest('hex').slice(0, 12)
  const fileStem = `cursor-${cursorAssetVersion}-${sessionKey}-${normalizedColor.slice(1).toLowerCase()}`
  const imagePath = join(cursorDir, `${fileStem}.svg`)
  const expectedSvg = createOneWorksCursorSvg({ color: normalizedColor })
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

const tryAcquireCursorPort = (host, port) =>
  new Promise((resolveAcquire, rejectAcquire) => {
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

const closeCursorPort = server =>
  new Promise(resolveClose => {
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
  let startPending = true
  let startPosition
  let startRevision = 0
  let startSource = 'default'

  return {
    getState() {
      return {
        color,
        cursorStart: startPosition ?? { mode: 'screen_center' },
        cursorStartSource: startSource,
        sessionId,
        source
      }
    },
    setColor(nextColor) {
      const normalized = normalizeCursorColor(nextColor)
      if (normalized == null) throw new TypeError('Cursor color must be a CSS hex color such as #625BF6.')
      color = normalized
      source = 'agent'
      return { color, sessionId, source }
    },
    setStartPosition(nextPosition) {
      startPosition = normalizeCursorStart(nextPosition)
      startPending = true
      startRevision += 1
      startSource = startPosition == null ? 'default' : 'agent'
      return {
        position: startPosition ?? { mode: 'screen_center' },
        sessionId,
        source: startSource
      }
    },
    async callTool(name, args) {
      if (!pointerActionTools.has(name)) return await options.callTool(name, args)
      const actionColor = color
      const reservedStart = startPending
        ? { position: startPosition, revision: startRevision }
        : undefined
      if (reservedStart != null) startPending = false
      let startApplied = false
      try {
        return await lock(async () => {
          if (!motionReady) {
            await options.callTool('set_agent_cursor_motion', directGlideMotion)
            motionReady = true
          }
          const imagePath = await materializeCursorSvg({
            color: actionColor,
            cursorDir: options.cursorDir,
            sessionId
          })
          await options.callTool('set_agent_cursor_style', {
            bloom_color: actionColor,
            image_path: imagePath
          })
          if (reservedStart != null) {
            const resolvedStart = await resolveCursorStart(options.callTool, reservedStart.position)
            await options.callTool('move_cursor', resolvedStart)
            startApplied = true
          }
          return await options.callTool(name, args)
        }, options.lockOptions)
      } catch (error) {
        if (
          reservedStart != null && !startApplied &&
          startRevision === reservedStart.revision
        ) startPending = true
        throw error
      }
    }
  }
}

const sessionCursorToolDefinition = {
  name: 'set_session_cursor_color',
  description:
    'Set the visual Agent pointer color for this OneWorks session. Use this when the user requests a specific color or needs concurrent CUA sessions to be visually distinguishable. The plugin owns and validates the color selection, then applies the shared rounded pointer design immediately before this session performs pointer actions.',
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

const sessionCursorStartToolDefinition = {
  name: 'set_session_cursor_start',
  description:
    'Set the virtual Agent pointer starting position for the next pointer action in this OneWorks session. Coordinates use logical points on the main display and never move the physical mouse. Use get_screen_size first when choosing explicit coordinates. Workflows may instead pass cursor_start; when omitted, each workflow starts from the main-display center.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['x', 'y'],
    properties: {
      x: { type: 'number', minimum: 0, description: 'Horizontal logical point on the main display.' },
      y: { type: 'number', minimum: 0, description: 'Vertical logical point on the main display.' }
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

function sessionCursorStartToolResult(state) {
  return {
    content: [{
      type: 'text',
      text: `Session pointer will start at (${state.position.x}, ${state.position.y}) before its next pointer action.`
    }],
    structuredContent: {
      position: state.position,
      source: state.source
    }
  }
}

module.exports = {
  createSessionCursorController,
  deriveSessionCursorColor,
  directGlideMotion,
  materializeCursorSvg,
  normalizeCursorColor,
  normalizeCursorStart,
  parseScreenSize,
  pointerActionTools,
  resolveCursorStart,
  resolveInitialCursorColor,
  sessionCursorStartToolDefinition,
  sessionCursorStartToolResult,
  sessionCursorToolDefinition,
  sessionCursorToolResult,
  withCursorActionLock
}
