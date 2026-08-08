export const createToolName = (path: readonly string[]) => {
  const safeSegments = path.map((segment) => {
    const sanitized = segment
      .trim()
      .replace(/[^\w-]+/gu, '_')
      .replace(/^_+|_+$/gu, '')
    return sanitized === '' ? 'command' : sanitized
  })
  return `channel.${safeSegments.join('.')}`
}

export const formatUsageAncestors = (path: readonly string[], prefix: string) =>
  path.map((segment, index) => index === 0 ? `${prefix}${segment}` : segment)

export const formatCommandPath = (path: readonly string[], prefix: string) =>
  path.map((segment, index) => index === 0 ? `${prefix}${segment}` : segment)
