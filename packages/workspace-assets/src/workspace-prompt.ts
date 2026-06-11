import type { WorkspaceDefinitionPayload } from '@oneworks/types'
import { resolvePromptPath } from '@oneworks/utils'

import { buildManagedTaskToolGuidance, resolveRuntimeProtocolCliCommand } from './task-tool-guidance'

export const generateWorkspaceRoutePrompt = (
  cwd: string,
  workspaces: WorkspaceDefinitionPayload[]
) => {
  if (workspaces.length === 0) return ''
  const taskToolGuidance = buildManagedTaskToolGuidance()
  const runtimeProtocolCommand =
    `${resolveRuntimeProtocolCliCommand()} --input-format stream-json --output-format stream-json`

  const workspaceList = workspaces
    .map((workspace) => {
      const description = workspace.description?.trim() || workspace.name?.trim() || workspace.path
      return (
        `  - Identifier: ${workspace.id}\n` +
        `    - Path: ${resolvePromptPath(cwd, workspace.cwd)}\n` +
        `    - Description: ${description}\n`
      )
    })
    .join('')

  return (
    '<system-prompt>\n' +
    'The project includes the following registered workspaces:\n' +
    `${workspaceList}\n` +
    `When a user request targets one of these workspaces, start a child runtime session with \`${runtimeProtocolCommand}\` and a \`session.start\` envelope; include the workspace identifier and path in the title and message. ` +
    'Do not directly edit files inside a registered workspace from the current session unless the user explicitly asks this session to work in that directory.\n' +
    `${taskToolGuidance}\n` +
    '</system-prompt>\n'
  )
}
