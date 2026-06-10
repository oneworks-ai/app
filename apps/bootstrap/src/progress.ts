import process from 'node:process'

const BAR_WIDTH = 24
const PULSE_WIDTH = 7
const TICK_MS = 120
const SPINNER_FRAMES = ['-', '\\', '|', '/']

export interface BootstrapProgress {
  fail: (summary?: string) => void
  finish: (summary?: string) => void
  setTotal: (total: number | undefined) => void
  update: (completed: number, total?: number) => void
}

const isTestRun = () => process.env.VITEST != null || process.env.VITEST_WORKER_ID != null

const formatElapsed = (startedAt: number) => {
  const totalSeconds = Math.max(0, Math.floor((Date.now() - startedAt) / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${seconds.toString().padStart(2, '0')}`
}

const formatBytes = (bytes: number) => {
  const normalized = Math.max(0, bytes)
  if (normalized < 1024) return `${normalized} B`

  const units = ['KB', 'MB', 'GB', 'TB']
  let value = normalized / 1024
  let unitIndex = 0
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex += 1
  }

  return `${value >= 10 ? value.toFixed(1) : value.toFixed(2)} ${units[unitIndex]}`
}

const normalizeTotal = (total: number | undefined) => (
  total != null && Number.isFinite(total) && total > 0 ? total : undefined
)

const trimToWidth = (value: string, width: number) => (
  value.length <= width ? value : `${value.slice(0, Math.max(0, width - 3))}...`
)

const buildDeterminateBar = (completed: number, total: number) => {
  const ratio = Math.max(0, Math.min(1, completed / total))
  const filled = Math.max(0, Math.min(BAR_WIDTH, Math.round(ratio * BAR_WIDTH)))
  return `${'#'.repeat(filled)}${'.'.repeat(BAR_WIDTH - filled)}`
}

const buildIndeterminateBar = (frame: number) => {
  const position = frame % (BAR_WIDTH + PULSE_WIDTH)
  const start = position - PULSE_WIDTH
  return Array.from({ length: BAR_WIDTH }, (_, index) => (
    index >= start && index < position ? '#' : '.'
  )).join('')
}

export const createBootstrapProgress = (params: {
  enabled?: boolean
  label: string
  total?: number
}): BootstrapProgress => {
  const enabled = params.enabled !== false && !isTestRun()
  const startedAt = Date.now()
  const tty = Boolean(process.stderr.isTTY)
  let completed = 0
  let failed = false
  let frame = 0
  let interval: NodeJS.Timeout | undefined
  let stopped = false
  let total = normalizeTotal(params.total)
  let wrote = false

  const buildLine = (summary?: string) => {
    const hasTotal = total != null
    const progressText = hasTotal
      ? `${Math.round(Math.max(0, Math.min(1, completed / total)) * 100)}% ${formatBytes(completed)}/${
        formatBytes(total)
      }`
      : stopped && !failed
      ? 'done'
      : 'working'
    const bar = failed
      ? `${'#'.repeat(Math.max(1, Math.round(BAR_WIDTH / 3)))}${
        '.'.repeat(
          BAR_WIDTH - Math.max(1, Math.round(BAR_WIDTH / 3))
        )
      }`
      : hasTotal
      ? buildDeterminateBar(completed, total)
      : stopped
      ? '#'.repeat(BAR_WIDTH)
      : buildIndeterminateBar(frame)
    const marker = failed ? '!' : stopped ? ' ' : SPINNER_FRAMES[frame % SPINNER_FRAMES.length]
    return `[bootstrap] ${marker} [${bar}] ${progressText} ${trimToWidth(summary ?? params.label, 72)} ${
      formatElapsed(startedAt)
    }`
  }

  const stopTicker = () => {
    if (interval == null) return
    clearInterval(interval)
    interval = undefined
  }

  const render = (summary?: string) => {
    if (!enabled) return
    wrote = true

    if (tty) {
      process.stderr.write(`\r${buildLine(summary)}\x1B[K`)
      frame += 1
      return
    }

    if (!stopped && frame > 0) return
    process.stderr.write(`${buildLine(summary)}\n`)
    frame += 1
  }

  const finishLine = (summary?: string) => {
    if (!enabled || !wrote) return
    if (tty) {
      process.stderr.write(`\r${buildLine(summary)}\x1B[K\n`)
      return
    }
    process.stderr.write(`${buildLine(summary)}\n`)
  }

  if (enabled) {
    render()
    if (tty) {
      interval = setInterval(() => render(), TICK_MS)
      interval.unref()
    }
  }

  return {
    setTotal(nextTotal) {
      total = normalizeTotal(nextTotal)
      render()
    },
    update(nextCompleted, nextTotal) {
      const normalizedTotal = normalizeTotal(nextTotal)
      if (normalizedTotal != null) {
        total = normalizedTotal
      }
      completed = Math.max(0, nextCompleted)
      if (total != null) {
        completed = Math.min(completed, total)
      }
      render()
    },
    finish(summary) {
      if (stopped) return
      stopped = true
      if (total != null) {
        completed = total
      }
      stopTicker()
      finishLine(summary)
    },
    fail(summary) {
      if (stopped) return
      stopped = true
      failed = true
      stopTicker()
      finishLine(summary)
    }
  }
}
