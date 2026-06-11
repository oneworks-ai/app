import { useEffect, useMemo, useState } from 'react'

import type { InteractionPanelIframePage } from './InteractionPanelIframeView'
import {
  MAX_VISIBLE_RECENT_RESOURCE_RESULTS,
  MAX_VISIBLE_RESOURCE_RESULTS,
  buildInteractionPanelRecentFileResources,
  collectInteractionPanelChildSessions,
  collectInteractionPanelWorkspaceFiles,
  compareInteractionPanelRecentResources,
  compareInteractionPanelResources,
  getInteractionPanelResourceText
} from './interaction-panel-resource-search'
import type { InteractionPanelResourceSearchResult } from './interaction-panel-resource-search'
import { buildInteractionPanelWebsiteResources } from './interaction-panel-website-resources'

const SEARCH_DEBOUNCE_MS = 180
const normalizeSearchText = (value: string) => value.trim().toLowerCase()

export function useInteractionPanelResourceSearch({
  iframePages,
  open,
  projectUrlHistoryKey,
  query,
  recentFilePaths,
  sessionId,
  sessionUrlHistoryKey
}: {
  iframePages: InteractionPanelIframePage[]
  open: boolean
  projectUrlHistoryKey: string
  query: string
  recentFilePaths: string[]
  sessionId?: string
  sessionUrlHistoryKey: string
}) {
  const rawNormalizedQuery = normalizeSearchText(query)
  const [normalizedQuery, setNormalizedQuery] = useState('')
  const hasQuery = normalizedQuery !== ''
  const [files, setFiles] = useState<InteractionPanelResourceSearchResult[]>([])
  const [sessions, setSessions] = useState<InteractionPanelResourceSearchResult[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [hasError, setHasError] = useState(false)

  useEffect(() => {
    if (!open || rawNormalizedQuery === '') {
      setNormalizedQuery('')
      return
    }

    const timeout = window.setTimeout(() => setNormalizedQuery(rawNormalizedQuery), SEARCH_DEBOUNCE_MS)
    return () => window.clearTimeout(timeout)
  }, [open, rawNormalizedQuery])

  useEffect(() => {
    if (!open) return

    let isCancelled = false
    const queryTokens = normalizedQuery.split(/\s+/).filter(Boolean)
    setHasError(false)
    setIsLoading(true)
    void Promise.allSettled([
      hasQuery
        ? collectInteractionPanelWorkspaceFiles({ sessionId, queryTokens, isCancelled: () => isCancelled })
        : [],
      collectInteractionPanelChildSessions(sessionId)
    ])
      .then(([filesResult, sessionsResult]) => {
        if (isCancelled) return
        setFiles(filesResult.status === 'fulfilled' ? filesResult.value : [])
        setSessions(sessionsResult.status === 'fulfilled' ? sessionsResult.value : [])
        setHasError(filesResult.status === 'rejected' || sessionsResult.status === 'rejected')
      })
      .finally(() => {
        if (!isCancelled) setIsLoading(false)
      })

    return () => {
      isCancelled = true
    }
  }, [hasQuery, normalizedQuery, open, sessionId])

  const recentFiles = useMemo(() => buildInteractionPanelRecentFileResources(recentFilePaths), [recentFilePaths])

  const websites = useMemo(() => {
    if (!open) return []
    return buildInteractionPanelWebsiteResources({ iframePages, projectUrlHistoryKey, sessionUrlHistoryKey })
  }, [iframePages, open, projectUrlHistoryKey, sessionUrlHistoryKey])

  const results = useMemo(() => {
    const tokens = normalizedQuery.split(/\s+/).filter(Boolean)
    if (!hasQuery) {
      return [...recentFiles, ...sessions, ...websites]
        .sort(compareInteractionPanelRecentResources)
        .slice(0, MAX_VISIBLE_RECENT_RESOURCE_RESULTS)
    }

    const resources = [...files, ...sessions, ...websites]
    const matchedResources = tokens.length === 0
      ? resources
      : resources.filter(resource => {
        const text = getInteractionPanelResourceText(resource).toLowerCase()
        return tokens.every(token => text.includes(token))
      })

    return [...matchedResources]
      .sort(compareInteractionPanelResources(normalizedQuery))
      .slice(0, MAX_VISIBLE_RESOURCE_RESULTS)
  }, [files, hasQuery, normalizedQuery, recentFiles, sessions, websites])

  return {
    hasError,
    isLoading: isLoading || (open && rawNormalizedQuery !== normalizedQuery),
    results
  }
}
