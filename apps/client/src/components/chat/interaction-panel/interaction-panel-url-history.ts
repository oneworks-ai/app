export interface InteractionPanelUrlHistoryEntry {
  faviconUrl?: string
  title?: string
  updatedAt: number
  url: string
}

export interface InteractionPanelUrlHistoryScope {
  key: string
  kind: 'project' | 'session'
}

const URL_HISTORY_LIMIT = 80

const buildUrlHistoryStorageKey = (scope: InteractionPanelUrlHistoryScope) =>
  `chatInteractionUrlHistory:${scope.kind}:${encodeURIComponent(scope.key)}`

const normalizeUrlHistoryEntry = (value: unknown): InteractionPanelUrlHistoryEntry | null => {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) return null
  const entry = value as Partial<InteractionPanelUrlHistoryEntry>
  if (typeof entry.url !== 'string' || entry.url.trim() === '') return null
  return {
    url: entry.url.trim(),
    updatedAt: typeof entry.updatedAt === 'number' ? entry.updatedAt : 0,
    ...(typeof entry.title === 'string' && entry.title.trim() !== '' ? { title: entry.title.trim() } : {}),
    ...(typeof entry.faviconUrl === 'string' && entry.faviconUrl.trim() !== ''
      ? { faviconUrl: entry.faviconUrl.trim() }
      : {})
  }
}

export const readInteractionPanelUrlHistory = (
  scopes: InteractionPanelUrlHistoryScope[]
): InteractionPanelUrlHistoryEntry[] => {
  if (typeof window === 'undefined') return []
  const entriesByUrl = new Map<string, InteractionPanelUrlHistoryEntry>()
  for (const scope of scopes) {
    try {
      const rawValue = window.localStorage.getItem(buildUrlHistoryStorageKey(scope))
      const parsedValue = rawValue == null ? [] : JSON.parse(rawValue)
      if (!Array.isArray(parsedValue)) continue
      for (const value of parsedValue) {
        const entry = normalizeUrlHistoryEntry(value)
        const existingEntry = entry == null ? undefined : entriesByUrl.get(entry.url)
        if (entry != null && (existingEntry == null || entry.updatedAt > existingEntry.updatedAt)) {
          entriesByUrl.set(entry.url, entry)
        }
      }
    } catch {
      // URL history is best-effort UI state.
    }
  }
  return [...entriesByUrl.values()]
    .sort((left, right) => right.updatedAt - left.updatedAt)
    .slice(0, URL_HISTORY_LIMIT)
}

export const upsertInteractionPanelUrlHistory = (
  scopes: InteractionPanelUrlHistoryScope[],
  entry: Omit<InteractionPanelUrlHistoryEntry, 'updatedAt'> & { updatedAt?: number }
) => {
  if (typeof window === 'undefined') return
  const normalizedEntry = normalizeUrlHistoryEntry({
    ...entry,
    updatedAt: entry.updatedAt ?? Date.now()
  })
  if (normalizedEntry == null) return

  for (const scope of scopes) {
    try {
      const key = buildUrlHistoryStorageKey(scope)
      const current = readInteractionPanelUrlHistory([scope])
      const next = [
        normalizedEntry,
        ...current.filter(item => item.url !== normalizedEntry.url)
      ].slice(0, URL_HISTORY_LIMIT)
      window.localStorage.setItem(key, JSON.stringify(next))
    } catch {
      // URL history is best-effort UI state.
    }
  }
}
