const LITERAL_ROOT_BOUNDARY_PATTERN = /[\s:"'`<>()[\]{},;=]/u
const LITERAL_PATH_END_PATTERN = /[\s:"'`<>()[\]{},;=]/u

export const hasLiteralRootBoundary = (
  value: string,
  start: number,
  end: number
) => {
  const before = value[start - 1]
  const after = value[end]
  const fileUrlPrefix = value.slice(Math.max(0, start - 7), start).toLowerCase() === 'file://'
  const beforeSafe = start === 0 ||
    fileUrlPrefix ||
    (before != null && LITERAL_ROOT_BOUNDARY_PATTERN.test(before))
  const afterSafe = value.slice(start, end).endsWith('/') ||
    value.slice(start, end).endsWith('\\') ||
    end === value.length ||
    after === '/' ||
    after === '\\' ||
    (after != null && LITERAL_ROOT_BOUNDARY_PATTERN.test(after))
  return beforeSafe && afterSafe
}

export const redactLiteralPrivateRoots = (
  value: string,
  roots: string[],
  replacement: string
) => {
  let redacted = value
  const variants = [
    ...new Set(roots.flatMap(root => [
      root,
      root.replaceAll('/', '\\')
    ]))
  ].sort((left, right) => right.length - left.length)
  for (const root of variants) {
    if (root === '') continue
    let cursor = 0
    while (cursor < redacted.length) {
      const windowsFamily = /^(?:[a-z]:[\\/]|[\\/]{2})/iu.test(root)
      const start = windowsFamily
        ? redacted.toLowerCase().indexOf(root.toLowerCase(), cursor)
        : redacted.indexOf(root, cursor)
      if (start < 0) break
      const end = start + root.length
      if (!hasLiteralRootBoundary(redacted, start, end)) {
        cursor = end
        continue
      }
      let privatePathEnd = end
      const rootEndsWithSeparator = root.endsWith('/') || root.endsWith('\\')
      if (
        rootEndsWithSeparator ||
        redacted[privatePathEnd] === '/' ||
        redacted[privatePathEnd] === '\\'
      ) {
        if (!rootEndsWithSeparator) privatePathEnd += 1
        while (
          privatePathEnd < redacted.length &&
          !LITERAL_PATH_END_PATTERN.test(redacted[privatePathEnd] ?? '')
        ) {
          privatePathEnd += 1
        }
      }
      const fileUrlPrefix = redacted.slice(Math.max(0, start - 7), start).toLowerCase() === 'file://'
      const replacementStart = fileUrlPrefix ? start - 7 : start
      redacted = `${redacted.slice(0, replacementStart)}${replacement}${redacted.slice(privatePathEnd)}`
      cursor = replacementStart + replacement.length
    }
  }
  return redacted
}
