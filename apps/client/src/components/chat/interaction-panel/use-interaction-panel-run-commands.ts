import { useCallback, useEffect, useMemo, useState } from 'react'
import useSWR from 'swr'

import type { ConfigResponse } from '@oneworks/types'

import { getConfig, updateConfig } from '#~/api'

import {
  buildInteractionPanelRunCommandsConfigPatch,
  getInteractionPanelRunCommandsFromConfig,
  normalizeInteractionPanelRunCommands,
  readInteractionPanelLastRunCommandId,
  writeInteractionPanelLastRunCommandId
} from './interaction-panel-run-commands'
import type { InteractionPanelRunCommand } from './interaction-panel-run-commands'

export function useInteractionPanelRunCommands(storageScope: string) {
  const { data: configRes, mutate } = useSWR<ConfigResponse>('/api/config', getConfig)
  const projectConversation = configRes?.sources?.project?.conversation
  const resolvedProjectConversation = configRes?.resolvedSources?.project?.conversation ?? projectConversation
  const configCommands = useMemo(
    () => getInteractionPanelRunCommandsFromConfig(resolvedProjectConversation),
    [resolvedProjectConversation]
  )
  const [commands, setCommands] = useState<InteractionPanelRunCommand[]>(configCommands)
  const [lastRunCommandId, setLastRunCommandId] = useState<string | null>(() =>
    readInteractionPanelLastRunCommandId(storageScope)
  )

  useEffect(() => {
    setCommands(configCommands)
  }, [configCommands])

  useEffect(() => {
    setLastRunCommandId(readInteractionPanelLastRunCommandId(storageScope))
  }, [storageScope])

  const saveCommands = useCallback((nextCommands: InteractionPanelRunCommand[]) => {
    const normalizedCommands = normalizeInteractionPanelRunCommands(nextCommands)
    setCommands(normalizedCommands)
    if (lastRunCommandId != null && !normalizedCommands.some(command => command.id === lastRunCommandId)) {
      setLastRunCommandId(null)
      writeInteractionPanelLastRunCommandId(storageScope, null)
    }

    const nextConversation = buildInteractionPanelRunCommandsConfigPatch(projectConversation, normalizedCommands)
    void updateConfig('project', 'conversation', nextConversation)
      .then(() => mutate())
      .catch((error: unknown) => {
        console.error('[interaction-panel] failed to save run commands', error)
        setCommands(configCommands)
      })
  }, [configCommands, lastRunCommandId, mutate, projectConversation, storageScope])

  const recordRunCommand = useCallback((commandId: string) => {
    setLastRunCommandId(commandId)
    writeInteractionPanelLastRunCommandId(storageScope, commandId)
  }, [storageScope])

  return {
    commands,
    lastRunCommandId,
    recordRunCommand,
    saveCommands
  }
}
