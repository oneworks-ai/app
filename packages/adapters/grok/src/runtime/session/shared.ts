import type { AdapterMessageContent } from '@oneworks/types'

export const getErrorMessage = (error: unknown) => (
  error instanceof Error ? error.message : String(error ?? 'Grok session failed unexpectedly')
)
export const toAdapterErrorData = (
  error: unknown,
  overrides: Partial<{ message: string; code: string; details: unknown; fatal: boolean }> = {}
) => ({
  message: overrides.message ?? getErrorMessage(error),
  ...(overrides.code != null ? { code: overrides.code } : {}),
  ...(overrides.details !== undefined ? { details: overrides.details } : {}),
  fatal: overrides.fatal ?? true
})

export const normalizeGrokPrompt = (content: AdapterMessageContent[]) => {
  const parts: string[] = []
  for (const item of content) {
    if (item.type === 'text' && item.text.trim() !== '') parts.push(item.text.trim())
    if (item.type === 'image' && item.url.trim() !== '') parts.push(`Attached image: ${item.url.trim()}`)
    if (item.type === 'file' && item.path.trim() !== '') parts.push(`Attached file: ${item.path.trim()}`)
    if (item.type === 'tool_result') {
      parts.push(typeof item.content === 'string' ? item.content : JSON.stringify(item.content))
    }
  }
  return parts.join('\n\n').trim() || 'Continue.'
}

export const isMissingGrokResume = (value: string) => (
  /session.*(?:not found|does not exist|missing)|no (?:matching|previous) session/i.test(value)
)
