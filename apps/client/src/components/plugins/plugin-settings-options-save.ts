interface PluginSettingsOptionsSaveControllerOptions {
  delayMs?: number
  initialOptions: Record<string, unknown>
  onError: (error: unknown) => void
  onSaved: (options: Record<string, unknown>) => void
  persist: (options: Record<string, unknown>) => Promise<Record<string, unknown>>
}

export interface PluginSettingsOptionsSaveController {
  dispose: () => Promise<void>
  flush: () => Promise<void>
  schedule: (options: Record<string, unknown>) => void
  syncRemote: (options: Record<string, unknown>) => boolean
}

const serializeOptions = (options: Record<string, unknown>) => JSON.stringify(options)

export function createPluginSettingsOptionsSaveController({
  delayMs = 700,
  initialOptions,
  onError,
  onSaved,
  persist
}: PluginSettingsOptionsSaveControllerOptions): PluginSettingsOptionsSaveController {
  let disposed = false
  let inFlight = 0
  let lastSaved = serializeOptions(initialOptions)
  let pending: Record<string, unknown> | undefined
  let queue = Promise.resolve()
  let timer: ReturnType<typeof setTimeout> | undefined
  let version = 0

  const clearTimer = () => {
    if (timer == null) return
    clearTimeout(timer)
    timer = undefined
  }

  const flush = async () => {
    clearTimer()
    if (pending == null) {
      await queue
      return
    }

    const nextOptions = pending
    pending = undefined
    const nextSerialized = serializeOptions(nextOptions)
    if (nextSerialized === lastSaved && inFlight === 0) return

    const saveVersion = version
    inFlight += 1
    const save = queue
      .catch(() => undefined)
      .then(() => persist(nextOptions))
    queue = save.then(() => undefined, () => undefined)

    try {
      const savedOptions = await save
      lastSaved = serializeOptions(savedOptions)
      if (!disposed && saveVersion === version && pending == null) onSaved(savedOptions)
    } catch (error) {
      if (saveVersion === version) onError(error)
    } finally {
      inFlight -= 1
    }
  }

  return {
    async dispose() {
      disposed = true
      await flush()
    },
    flush,
    schedule(options) {
      pending = options
      version += 1
      clearTimer()
      timer = setTimeout(() => void flush(), delayMs)
    },
    syncRemote(options) {
      if (pending != null || inFlight > 0) return false
      lastSaved = serializeOptions(options)
      return true
    }
  }
}
