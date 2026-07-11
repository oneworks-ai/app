import { parseWorkspaceFileLinkForWorkspaceRoot } from './link-targets'
import type { WorkspaceFileLinkTarget } from './link-targets'

export const MARKDOWN_LINK_INTENT_TITLE_PREFIX = 'oneworks:open='

export type MarkdownLinkIntent = 'external' | 'internal' | 'workspace-file'

const MARKDOWN_LINK_INTENTS = new Set<MarkdownLinkIntent>([
  'external',
  'internal',
  'workspace-file'
])

export const parseMarkdownLinkIntent = (title: unknown): MarkdownLinkIntent | undefined => {
  if (typeof title !== 'string') return undefined

  const normalized = title.trim()
  if (!normalized.startsWith(MARKDOWN_LINK_INTENT_TITLE_PREFIX)) return undefined

  const intent = normalized.slice(MARKDOWN_LINK_INTENT_TITLE_PREFIX.length)
  return MARKDOWN_LINK_INTENTS.has(intent as MarkdownLinkIntent)
    ? intent as MarkdownLinkIntent
    : undefined
}

export const buildMarkdownLinkIntentTitle = (intent: MarkdownLinkIntent) =>
  `${MARKDOWN_LINK_INTENT_TITLE_PREFIX}${intent}`

export type ResolvedMarkdownLinkIntentTarget =
  | { intent: 'external'; url: string }
  | { intent: 'internal'; url: string }
  | { intent: 'workspace-file'; target: WorkspaceFileLinkTarget }

const resolveHttpUrl = (href: string) => {
  try {
    const url = new URL(href.trim())
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : undefined
  } catch {
    return undefined
  }
}

export const resolveMarkdownLinkIntentTarget = (
  href: string,
  intent: MarkdownLinkIntent,
  workspaceRootPath?: string
): ResolvedMarkdownLinkIntentTarget | undefined => {
  if (intent === 'workspace-file') {
    const target = parseWorkspaceFileLinkForWorkspaceRoot(href, workspaceRootPath)
    return target == null ? undefined : { intent, target }
  }

  const url = resolveHttpUrl(href)
  return url == null ? undefined : { intent, url }
}
