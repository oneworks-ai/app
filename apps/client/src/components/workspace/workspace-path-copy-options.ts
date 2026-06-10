import type { TFunction } from 'i18next'

export interface WorkspacePathCopyOption {
  disabled?: boolean
  key: string
  label: string
  successMessage: string
  text: string
}

export const getWorkspacePathName = (path: string) => path.split('/').filter(Boolean).at(-1) ?? path

export const buildWorkspaceAbsolutePath = (workspaceRootPath: string | undefined, relativePath: string) => {
  const root = workspaceRootPath?.trim()
  const path = relativePath.trim()
  if (root == null || root === '' || path === '') return undefined

  const separator = root.includes('\\') && !root.includes('/') ? '\\' : '/'
  const normalizedPath = separator === '\\' ? path.replaceAll('/', '\\') : path
  return `${root.replace(/[\\/]+$/, '')}${separator}${normalizedPath}`
}

export const buildWorkspacePathCopyOptions = ({
  absolutePath,
  name,
  path,
  t,
  workspaceRootPath
}: {
  absolutePath?: string
  name?: string
  path: string
  t: TFunction
  workspaceRootPath?: string
}): WorkspacePathCopyOption[] => {
  const resolvedAbsolutePath = absolutePath ?? buildWorkspaceAbsolutePath(workspaceRootPath, path)
  return [
    {
      key: 'copy-name',
      label: t('chat.workspaceFileCopyName'),
      successMessage: t('chat.workspaceFileNameCopied'),
      text: name ?? getWorkspacePathName(path)
    },
    {
      key: 'copy-relative-path',
      label: t('chat.workspaceFileCopyRelativePath'),
      successMessage: t('chat.workspaceFileRelativePathCopied'),
      text: path
    },
    {
      key: 'copy-absolute-path',
      label: t('chat.workspaceFileCopyAbsolutePath'),
      successMessage: t('chat.workspaceFileAbsolutePathCopied'),
      text: resolvedAbsolutePath ?? '',
      ...(resolvedAbsolutePath == null ? { disabled: true } : {})
    }
  ]
}
