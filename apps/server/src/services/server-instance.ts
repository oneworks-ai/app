import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

import type { ServerEnv } from '@oneworks/core'
import { SERVER_INSTANCE_FILE_NAME, isServerInstanceState } from '@oneworks/types'
import type { ServerInstanceState } from '@oneworks/types'

export const resolveServerInstanceStatePath = (
  env: Pick<ServerEnv, '__ONEWORKS_PROJECT_SERVER_DATA_DIR__'>
) => resolve(env.__ONEWORKS_PROJECT_SERVER_DATA_DIR__, SERVER_INSTANCE_FILE_NAME)

export const readServerInstanceState = async (path: string): Promise<ServerInstanceState | undefined> => {
  try {
    const value = JSON.parse(await readFile(path, 'utf8')) as unknown
    return isServerInstanceState(value) ? value : undefined
  } catch {
    return undefined
  }
}

export const writeServerInstanceState = async (
  env: Pick<ServerEnv, '__ONEWORKS_PROJECT_SERVER_DATA_DIR__'>,
  state: ServerInstanceState
) => {
  const path = resolveServerInstanceStatePath(env)
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 })
}

export const removeServerInstanceStateForPid = async (
  env: Pick<ServerEnv, '__ONEWORKS_PROJECT_SERVER_DATA_DIR__'>,
  pid: number
) => {
  const path = resolveServerInstanceStatePath(env)
  const state = await readServerInstanceState(path)
  if (state?.pid === pid) await rm(path, { force: true })
}
