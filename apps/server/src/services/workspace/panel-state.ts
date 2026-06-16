import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { env as processEnv, pid as processPid } from 'node:process'

import type { SessionPanelState } from '@oneworks/core'
import { resolveProjectHomePath } from '@oneworks/utils/ai-path'

import { normalizeSessionPanelState } from '#~/db/sessions/panel-state.js'
import { getWorkspaceFolder } from '#~/services/config/index.js'
import { notifyWorkspacePanelStateUpdated } from '#~/services/session/runtime.js'

interface WorkspacePanelStateFile {
  panelState?: unknown
  updatedAt?: unknown
}

export interface WorkspacePanelStateResponse {
  panelState: SessionPanelState
  updatedAt: number
}

const emptyPanelState = (): SessionPanelState => normalizeSessionPanelState(null)

const getWorkspacePanelStatePath = () => (
  resolveProjectHomePath(getWorkspaceFolder(), processEnv, '.local', 'workspace', 'panel-state.json')
)

const normalizeUpdatedAt = (value: unknown) => (
  typeof value === 'number' && Number.isFinite(value) ? value : 0
)

export async function getWorkspacePanelState(): Promise<WorkspacePanelStateResponse> {
  try {
    const raw = await readFile(getWorkspacePanelStatePath(), 'utf8')
    const parsed = JSON.parse(raw) as WorkspacePanelStateFile
    return {
      panelState: normalizeSessionPanelState(parsed.panelState),
      updatedAt: normalizeUpdatedAt(parsed.updatedAt)
    }
  } catch {
    return {
      panelState: emptyPanelState(),
      updatedAt: 0
    }
  }
}

export async function updateWorkspacePanelState(value: unknown): Promise<WorkspacePanelStateResponse> {
  const panelState = normalizeSessionPanelState(value)
  const updatedAt = Date.now()
  const statePath = getWorkspacePanelStatePath()
  const tempPath = `${statePath}.${processPid}.${updatedAt}.tmp`
  const payload: WorkspacePanelStateFile = { panelState, updatedAt }

  await mkdir(path.dirname(statePath), { recursive: true })
  await writeFile(tempPath, `${JSON.stringify(payload, null, 2)}\n`)
  await rename(tempPath, statePath)
  notifyWorkspacePanelStateUpdated(panelState, updatedAt)
  return { panelState, updatedAt }
}
