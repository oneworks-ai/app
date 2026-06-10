const LANGUAGE_BY_EXTENSION: Record<string, string> = {
  css: 'css',
  go: 'go',
  html: 'html',
  js: 'javascript',
  json: 'json',
  jsx: 'javascript',
  less: 'less',
  md: 'markdown',
  mjs: 'javascript',
  py: 'python',
  rb: 'ruby',
  rs: 'rust',
  scss: 'scss',
  sh: 'shell',
  ts: 'typescript',
  tsx: 'typescript',
  yaml: 'yaml',
  yml: 'yaml'
}

const LANGUAGE_BY_FILE_NAME: Record<string, string> = {
  Dockerfile: 'dockerfile'
}

const IMAGE_EXTENSIONS = new Set([
  'apng',
  'avif',
  'bmp',
  'gif',
  'ico',
  'jpeg',
  'jpg',
  'png',
  'svg',
  'webp'
])

const MARKDOWN_PREVIEW_EXTENSIONS = new Set(['md', 'markdown', 'mdown', 'mkd'])
const SHELL_SCRIPT_EXTENSIONS = new Set(['bash', 'sh', 'zsh'])

export type WorkspaceMarkdownPreviewMode = 'editor' | 'split' | 'preview'

const getWorkspaceFileExtension = (path: string) => {
  const fileName = path.split('/').pop() ?? path
  return fileName.includes('.') ? fileName.split('.').pop()?.toLowerCase() ?? '' : ''
}

export const getWorkspaceFileEditorLanguage = (path: string) => {
  const fileName = path.split('/').pop() ?? path
  const exactLanguage = LANGUAGE_BY_FILE_NAME[fileName]
  if (exactLanguage != null) {
    return exactLanguage
  }

  const extension = getWorkspaceFileExtension(path)
  return LANGUAGE_BY_EXTENSION[extension] ?? 'plaintext'
}

export const isWorkspaceImagePreviewPath = (path: string) => IMAGE_EXTENSIONS.has(getWorkspaceFileExtension(path))

export const isWorkspaceMarkdownPreviewPath = (path: string) =>
  MARKDOWN_PREVIEW_EXTENSIONS.has(getWorkspaceFileExtension(path))

export const isWorkspaceShellScriptPath = (path: string) => SHELL_SCRIPT_EXTENSIONS.has(getWorkspaceFileExtension(path))
