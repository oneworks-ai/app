import { homedir } from 'node:os'
import { resolve } from 'node:path'
import process from 'node:process'

import type { AdapterCtx } from '@oneworks/types'

const readString = (value: unknown) => (
  typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
)

export const resolveRealHome = (env: AdapterCtx['env']) => (
  readString(env.__ONEWORKS_PROJECT_REAL_HOME__) ??
    readString(process.env.__ONEWORKS_PROJECT_REAL_HOME__) ??
    homedir()
)

export const resolveRealCodexHome = (env: AdapterCtx['env']) => (
  resolve(readString(env.CODEX_HOME) ?? resolve(resolveRealHome(env), '.codex'))
)
