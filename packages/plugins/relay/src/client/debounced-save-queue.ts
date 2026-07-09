export interface DebouncedSaveQueue<T> {
  flushAll: () => void
  schedule: (key: string, value: T, save: (value: T) => Promise<void> | void, delayMs?: number) => void
}

interface PendingSave<T> {
  save: (value: T) => Promise<void> | void
  timerId: ReturnType<typeof globalThis.setTimeout>
  value: T
}

export const createDebouncedSaveQueue = <T>(defaultDelayMs: number): DebouncedSaveQueue<T> => {
  const pendingSaves = new Map<string, PendingSave<T>>()
  const runningSaves = new Map<string, Promise<void>>()

  const run = (key: string, pending: Omit<PendingSave<T>, 'timerId'>) => {
    const previous = runningSaves.get(key) ?? Promise.resolve()
    const next = previous
      .catch(() => undefined)
      .then(() => pending.save(pending.value))
      .then(() => undefined, () => undefined)
    runningSaves.set(key, next)
    void next.finally(() => {
      if (runningSaves.get(key) === next) runningSaves.delete(key)
    })
  }

  const flush = (key: string) => {
    const pending = pendingSaves.get(key)
    if (pending == null) return
    globalThis.clearTimeout(pending.timerId)
    pendingSaves.delete(key)
    run(key, pending)
  }

  return {
    flushAll: () => [...pendingSaves.keys()].forEach(flush),
    schedule: (key, value, save, delayMs = defaultDelayMs) => {
      const current = pendingSaves.get(key)
      if (current != null) globalThis.clearTimeout(current.timerId)
      const timerId = globalThis.setTimeout(() => flush(key), Math.max(0, delayMs))
      pendingSaves.set(key, { save, timerId, value })
    }
  }
}
