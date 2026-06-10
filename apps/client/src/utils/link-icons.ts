import { getPathExtension, isExternalUrl, normalizeWorkspaceFileLink } from './link-targets'

export interface LinkIconMeta {
  icon: string
  imageUrl?: string
  kind: 'external' | 'link' | 'local-file' | 'workspace-file'
  tone: string
}

const GITHUB_FAVICON_URL = 'https://github.githubassets.com/favicons/favicon.svg'

const stripLineColumnSuffix = (value: string) => value.replace(/(?::\d+){1,2}$/, '')
const getFileName = (value: string) => stripLineColumnSuffix(value).split('/').filter(Boolean).at(-1) ?? value

const isGitHubUrl = (value: string) => {
  try {
    const hostname = new URL(value).hostname.toLowerCase()
    return hostname === 'github.com' || hostname.endsWith('.github.com')
  } catch {
    return false
  }
}

export const getFileLinkIconMeta = (value: string): Omit<LinkIconMeta, 'kind'> => {
  const fileName = getFileName(value).toLowerCase()
  const extension = getPathExtension(stripLineColumnSuffix(value))

  if (fileName === 'package.json') return { icon: 'inventory_2', tone: 'package' }
  if (fileName === 'dockerfile' || fileName === 'docker-compose.yml' || fileName === 'docker-compose.yaml') {
    return { icon: 'deployed_code', tone: 'docker' }
  }
  if (fileName.includes('lock')) return { icon: 'lock', tone: 'lock' }
  if (fileName.startsWith('.env')) return { icon: 'key', tone: 'env' }
  if (fileName.includes('config')) return { icon: 'tune', tone: 'config' }
  if (fileName.includes('readme') || extension === 'md' || extension === 'mdx') {
    return { icon: 'article', tone: 'markdown' }
  }
  if (fileName.includes('gitignore') || fileName.includes('dockerignore')) {
    return { icon: 'hide_source', tone: 'ignore' }
  }

  if (['ts', 'tsx', 'mts', 'cts'].includes(extension)) return { icon: 'data_object', tone: 'typescript' }
  if (['js', 'jsx', 'mjs', 'cjs'].includes(extension)) return { icon: 'javascript', tone: 'javascript' }
  if (['json', 'jsonc'].includes(extension)) return { icon: 'data_object', tone: 'json' }
  if (['yml', 'yaml', 'toml'].includes(extension)) return { icon: 'settings', tone: 'config' }
  if (['css', 'scss', 'sass', 'less', 'pcss'].includes(extension)) return { icon: 'palette', tone: 'style' }
  if (['html', 'htm'].includes(extension)) return { icon: 'language', tone: 'html' }
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'svg', 'ico'].includes(extension)) {
    return { icon: 'image', tone: 'image' }
  }
  if (['sh', 'bash', 'zsh', 'fish', 'ps1'].includes(extension)) return { icon: 'terminal', tone: 'script' }
  if (['py', 'pyw'].includes(extension)) return { icon: 'code', tone: 'python' }
  if (extension === 'go') return { icon: 'code', tone: 'go' }
  if (extension === 'rs') return { icon: 'code', tone: 'rust' }
  if (['java', 'kt', 'kts', 'swift'].includes(extension)) return { icon: 'code', tone: 'language' }
  if (['sql', 'sqlite', 'db'].includes(extension)) return { icon: 'database', tone: 'database' }
  if (extension === 'pdf') return { icon: 'picture_as_pdf', tone: 'pdf' }
  if (['zip', 'tar', 'gz', 'tgz', 'rar', '7z'].includes(extension)) return { icon: 'folder_zip', tone: 'archive' }

  return { icon: 'draft', tone: 'file' }
}

export const getMarkdownLinkIconMeta = (href: string): LinkIconMeta => {
  const workspacePath = normalizeWorkspaceFileLink(href)
  if (workspacePath != null) {
    return {
      ...getFileLinkIconMeta(workspacePath),
      kind: 'workspace-file'
    }
  }

  const trimmed = href.trim()
  if (/^file:/i.test(trimmed)) {
    try {
      return {
        ...getFileLinkIconMeta(decodeURIComponent(new URL(trimmed).pathname)),
        kind: 'local-file'
      }
    } catch {
      return { icon: 'draft', kind: 'local-file', tone: 'file' }
    }
  }

  if (!isExternalUrl(trimmed)) {
    return { icon: 'link', kind: 'link', tone: 'link' }
  }

  const scheme = trimmed.match(/^([a-z][a-z0-9+.-]*):/i)?.[1]?.toLowerCase()
  if (scheme === 'mailto') return { icon: 'alternate_email', kind: 'external', tone: 'mail' }
  if (scheme === 'tel') return { icon: 'call', kind: 'external', tone: 'phone' }
  if (scheme === 'http' || scheme === 'https') {
    if (isGitHubUrl(trimmed)) {
      return { icon: 'github', imageUrl: GITHUB_FAVICON_URL, kind: 'external', tone: 'github' }
    }
    return { icon: 'public', kind: 'external', tone: 'web' }
  }
  return { icon: 'open_in_new', kind: 'external', tone: 'external' }
}
