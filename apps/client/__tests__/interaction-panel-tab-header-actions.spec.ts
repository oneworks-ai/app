import { describe, expect, it, vi } from 'vitest'

import {
  buildInteractionPanelRunCommandScript,
  normalizeInteractionPanelRunCommands
} from '#~/components/chat/interaction-panel/interaction-panel-run-commands'
import { buildInteractionPanelTabHeaderActions } from '#~/components/chat/interaction-panel/interaction-panel-tab-header-actions'

const t = ((key: string, options?: Record<string, string>) => {
  if (key === 'chat.interactionPanel.runShellFile') return 'Run script'
  if (key === 'chat.interactionPanel.runShellFileTitle') return `Run ${options?.file ?? ''}`
  return key
}) as any

describe('interaction panel tab header actions', () => {
  it('adds a run action for shell script file tabs', () => {
    const onRunCommand = vi.fn()
    const actions = buildInteractionPanelTabHeaderActions({
      onRunCommand,
      t,
      tab: {
        canClose: true,
        icon: 'terminal',
        id: 'file:scripts/dev.sh',
        kind: 'file',
        label: 'dev.sh',
        path: 'scripts/dev.sh'
      },
      workspaceRootPath: '/repo'
    })

    expect(actions).toHaveLength(1)
    expect(actions[0]).toMatchObject({
      icon: 'play_arrow',
      key: 'run-shell-file',
      label: 'Run script'
    })

    actions[0]?.run()

    expect(onRunCommand).toHaveBeenCalledWith({
      cwd: '/repo',
      icon: 'play_arrow',
      id: 'workspace-file:scripts/dev.sh:run-shell-script',
      name: 'Run dev.sh',
      script: "bash 'scripts/dev.sh'"
    })
  })

  it('does not add file run actions for non-shell files', () => {
    expect(buildInteractionPanelTabHeaderActions({
      onRunCommand: vi.fn(),
      t,
      tab: {
        canClose: true,
        icon: 'article',
        id: 'file:README.md',
        kind: 'file',
        label: 'README.md',
        path: 'README.md'
      }
    })).toEqual([])
  })

  it('preserves a whitespace-bearing workspace cwd for the executable command', () => {
    const onRunCommand = vi.fn()
    const workspaceRootPath = '/repo/ project '
    const actions = buildInteractionPanelTabHeaderActions({
      onRunCommand,
      t,
      tab: {
        canClose: true,
        icon: 'terminal',
        id: 'file:scripts/dev.sh',
        kind: 'file',
        label: 'dev.sh',
        path: 'scripts/dev.sh'
      },
      workspaceRootPath
    })

    actions[0]?.run()

    expect(onRunCommand).toHaveBeenCalledWith(expect.objectContaining({ cwd: workspaceRootPath }))
    const [command] = normalizeInteractionPanelRunCommands([onRunCommand.mock.calls[0]![0]])
    expect(command?.cwd).toBe(workspaceRootPath)
    expect(buildInteractionPanelRunCommandScript(command!)).toBe(
      `cd '${workspaceRootPath}'\nbash 'scripts/dev.sh'`
    )
  })
})
