const EXTERNAL_MARKDOWN_RESOURCE_PATTERN = /^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i

export const resolveWorkspaceMarkdownLinkedPath = (currentPath: string, href: string) => {
  const trimmedHref = href.trim()
  if (trimmedHref === '' || EXTERNAL_MARKDOWN_RESOURCE_PATTERN.test(trimmedHref)) {
    return null
  }

  const suffixIndex = trimmedHref.search(/[?#]/)
  const hrefPath = suffixIndex >= 0 ? trimmedHref.slice(0, suffixIndex) : trimmedHref
  if (hrefPath === '') {
    return null
  }

  const baseSegments = hrefPath.startsWith('/') ? [] : currentPath.split('/').slice(0, -1)
  const normalizedSegments: string[] = []
  for (const segment of [...baseSegments, ...hrefPath.split('/')]) {
    if (segment === '' || segment === '.') {
      continue
    }
    if (segment === '..') {
      normalizedSegments.pop()
      continue
    }
    normalizedSegments.push(segment)
  }

  return normalizedSegments.join('/')
}
