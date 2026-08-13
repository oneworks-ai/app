import { homedir } from 'node:os'
import { resolve } from 'node:path'
import process from 'node:process'

import type { AdapterCtx } from '@oneworks/types'

const readFilesystemPath = (value: unknown) => (
  typeof value === 'string' && value.trim() !== '' ? value : undefined
)

export const resolveRealHome = (env: AdapterCtx['env']) => (
  readFilesystemPath(env.__ONEWORKS_PROJECT_REAL_HOME__) ??
    readFilesystemPath(process.env.__ONEWORKS_PROJECT_REAL_HOME__) ??
    homedir()
)

export const resolveRealCodexHome = (env: AdapterCtx['env']) => (
  resolve(readFilesystemPath(env.CODEX_HOME) ?? resolve(resolveRealHome(env), '.codex'))
)
