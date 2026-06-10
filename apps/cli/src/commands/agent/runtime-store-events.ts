import { existsSync } from 'node:fs'
import process from 'node:process'

import type { RuntimeEvent, RuntimeEventDraft } from '@oneworks/runtime-store'

import { getStore } from './runtime-store-shared'

export const readRuntimeEvents = async (
  cwd: string,
  sessionId: string,
  env: NodeJS.ProcessEnv = process.env
) => {
  const session = (await getStore(cwd, env)).session(sessionId)
  if (!existsSync(session.sessionPath)) throw new Error(`Runtime session "${sessionId}" not found.`)
  return session.replayEvents()
}

export const appendRuntimeEventForTest = async (
  cwd: string,
  sessionId: string,
  event: RuntimeEvent | RuntimeEventDraft,
  env: NodeJS.ProcessEnv = process.env
) => (await getStore(cwd, env)).session(sessionId).appendEvent(event)
