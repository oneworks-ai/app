import type { WorkspaceFileOpenerId, WorkspaceFileOpenersResponse } from '@oneworks/types'

import { createServerUrl } from '#~/runtime-config'

export interface WorkspaceFileOpenerSelectModel {
  defaultOpenerTitle?: string
  defaultOpenerValue?: WorkspaceFileOpenerId
  icon: string
  kind: 'auto' | 'detected'
  title?: string
  value: 'auto' | WorkspaceFileOpenerId
}

const WORKSPACE_FILE_OPENER_ICONS: Record<WorkspaceFileOpenerId, string> = {
  vscode: 'developer_mode',
  cursor: 'near_me',
  windsurf: 'air',
  zed: 'terminal',
  intellij: 'data_object',
  webstorm: 'web',
  pycharm: 'code',
  goland: 'deployed_code',
  textedit: 'edit_note'
}

export const getWorkspaceFileOpenerIcon = (opener: WorkspaceFileOpenerId) => (
  WORKSPACE_FILE_OPENER_ICONS[opener] ?? 'open_in_new'
)

export const resolveWorkspaceOpenerIconUrl = (iconUrl: string | undefined) => {
  const trimmedIconUrl = iconUrl?.trim()
  if (trimmedIconUrl == null || trimmedIconUrl === '') return undefined
  if (/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(trimmedIconUrl)) return trimmedIconUrl
  return createServerUrl(trimmedIconUrl)
}

export const resolveWorkspaceFileOpenerSelectModels = (
  response: WorkspaceFileOpenersResponse | null | undefined
): WorkspaceFileOpenerSelectModel[] => {
  const openers = response?.openers ?? []
  const availableOpeners = openers.filter(opener => opener.available)
  const defaultOpener = openers.find(opener => opener.id === response?.defaultOpener)

  return [
    {
      icon: 'auto_awesome',
      kind: 'auto',
      value: 'auto',
      ...(defaultOpener != null
        ? {
          defaultOpenerTitle: defaultOpener.title,
          defaultOpenerValue: defaultOpener.id
        }
        : {})
    },
    ...availableOpeners.map(opener => ({
      icon: getWorkspaceFileOpenerIcon(opener.id),
      kind: 'detected' as const,
      title: opener.title,
      value: opener.id
    }))
  ]
}
