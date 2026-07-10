export interface DebouncedSaveQueue<T> {
  flushAll: () => void
  schedule: (key: string, value: T, save: (value: T) => Promise<void> | void, delayMs?: number) => void
}

export interface SerializedSaveResult {
  error?: unknown
  latest: boolean
  saved: boolean
}

export interface SerializedSaveQueue {
  enqueue: (key: string, save: () => Promise<void> | void) => Promise<SerializedSaveResult>
  waitForIdle: (key: string) => Promise<void>
  waitForIdleByPrefix: (prefix: string) => Promise<void>
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

export const createSerializedSaveQueue = (): SerializedSaveQueue => {
  const revisions = new Map<string, number>()
  const runningSaves = new Map<string, Promise<void>>()

  const waitForIdle = async (key: string) => {
    while (runningSaves.has(key)) {
      await runningSaves.get(key)?.catch(() => undefined)
    }
  }

  const waitForIdleByPrefix = async (prefix: string) => {
    while (true) {
      const matchingSaves = [...runningSaves.entries()]
        .filter(([key]) => key.startsWith(prefix))
        .map(([, save]) => save.catch(() => undefined))
      if (matchingSaves.length === 0) return
      await Promise.all(matchingSaves)
    }
  }

  return {
    enqueue: async (key, save) => {
      const revision = (revisions.get(key) ?? 0) + 1
      revisions.set(key, revision)
      let error: unknown
      const previous = runningSaves.get(key) ?? Promise.resolve()
      const next = previous
        .catch(() => undefined)
        .then(async () => {
          try {
            await save()
          } catch (nextError) {
            error = nextError
          }
        })
      runningSaves.set(key, next)
      await next
      if (runningSaves.get(key) === next) runningSaves.delete(key)

      const latest = revisions.get(key) === revision
      if (latest) revisions.delete(key)

      return {
        ...(error == null ? {} : { error }),
        latest,
        saved: error == null
      }
    },
    waitForIdle,
    waitForIdleByPrefix
  }
}
