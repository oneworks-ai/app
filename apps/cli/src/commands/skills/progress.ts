import process from 'node:process'

export interface SkillsProgressReporter {
  completeStep: (label: string) => void
  fail: (label?: string) => void
  failStep: (label: string) => void
  finish: (summary?: string) => void
  startStep: (label: string) => void
}

const BAR_WIDTH = 20
const TICK_MS = 120
const SPINNER_FRAMES = ['-', '\\', '|', '/']

const formatElapsed = (startedAt: number) => {
  const totalSeconds = Math.max(0, Math.floor((Date.now() - startedAt) / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${seconds.toString().padStart(2, '0')}`
}

const trimToWidth = (value: string, width: number) => (
  value.length <= width ? value : `${value.slice(0, Math.max(0, width - 3))}...`
)

export const createSkillsProgress = (params: {
  enabled?: boolean
} = {}): SkillsProgressReporter => {
  const enabled = params.enabled !== false && process.env.VITEST_WORKER_ID == null
  const startedAt = Date.now()
  const tty = Boolean(process.stderr.isTTY)
  let activeLabel: string | undefined
  let completed = 0
  let failed = false
  let frame = 0
  let interval: NodeJS.Timeout | undefined
  let total = 0
  let wrote = false

  const buildLine = (label = activeLabel ?? 'Done') => {
    const ratio = total === 0 ? 1 : completed / total
    const filled = Math.max(0, Math.min(BAR_WIDTH, Math.round(ratio * BAR_WIDTH)))
    const bar = `${'#'.repeat(filled)}${'.'.repeat(BAR_WIDTH - filled)}`
    const spinner = activeLabel == null ? ' ' : SPINNER_FRAMES[frame % SPINNER_FRAMES.length]
    return `[oneworks] ${spinner} [${bar}] ${completed}/${total} ${trimToWidth(label, 72)} ${formatElapsed(startedAt)}`
  }

  const render = () => {
    if (!enabled || total === 0) return
    wrote = true
    if (tty) {
      process.stderr.write(`\r${buildLine()}\x1B[K`)
      frame++
      return
    }

    if (activeLabel != null) {
      process.stderr.write(`${buildLine(activeLabel)}\n`)
    }
  }

  const ensureTicker = () => {
    if (!enabled || !tty || interval != null) return
    interval = setInterval(render, TICK_MS)
    interval.unref()
  }

  const stopTicker = () => {
    if (interval == null) return
    clearInterval(interval)
    interval = undefined
  }

  const finishLine = (summary?: string) => {
    if (!enabled || !wrote) return
    const label = summary ?? (failed ? 'Failed' : 'Done')
    if (tty) {
      process.stderr.write(`\r${buildLine(label)}\x1B[K\n`)
      return
    }
    process.stderr.write(`[oneworks] ${label} (${formatElapsed(startedAt)})\n`)
  }

  return {
    startStep(label) {
      if (!enabled) return
      total++
      activeLabel = label
      render()
      ensureTicker()
    },
    completeStep(label) {
      if (!enabled) return
      completed = Math.min(total, completed + 1)
      activeLabel = undefined
      if (!tty) {
        process.stderr.write(`[oneworks] done ${label} (${completed}/${total}, ${formatElapsed(startedAt)})\n`)
      } else {
        render()
      }
    },
    failStep(label) {
      if (!enabled) return
      failed = true
      activeLabel = undefined
      if (!tty) {
        process.stderr.write(`[oneworks] failed ${label} (${formatElapsed(startedAt)})\n`)
      } else {
        render()
      }
    },
    fail(label) {
      if (!enabled) return
      failed = true
      activeLabel = undefined
      stopTicker()
      finishLine(label ?? 'Failed')
    },
    finish(summary) {
      if (!enabled) return
      activeLabel = undefined
      stopTicker()
      finishLine(summary)
    }
  }
}
