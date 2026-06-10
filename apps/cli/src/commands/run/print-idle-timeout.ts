import { InvalidArgumentError } from 'commander'

export const parsePrintIdleTimeoutSeconds = (value: string) => {
  const seconds = Number(value)
  if (!Number.isFinite(seconds) || seconds <= 0) {
    throw new InvalidArgumentError('--print-idle-timeout must be a positive number of seconds.')
  }
  return seconds
}

export const createPrintIdleTimeoutController = (params: {
  timeoutSeconds: number
  onTimeout: () => void
  setTimer?: typeof setTimeout
  clearTimer?: typeof clearTimeout
}) => {
  const timeoutMs = Math.ceil(params.timeoutSeconds * 1000)
  const setTimer = params.setTimer ?? setTimeout
  const clearTimer = params.clearTimer ?? clearTimeout
  let timer: ReturnType<typeof setTimeout> | undefined
  let stopped = false

  const clear = () => {
    if (timer == null) return
    clearTimer(timer)
    timer = undefined
  }

  const arm = () => {
    if (stopped) return
    clear()
    timer = setTimer(() => {
      timer = undefined
      if (stopped) return
      params.onTimeout()
    }, timeoutMs)
  }

  return {
    start: arm,
    recordEvent: arm,
    stop: () => {
      stopped = true
      clear()
    }
  }
}
