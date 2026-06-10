import type { ChildProcess } from 'node:child_process'
import { join } from 'node:path'

import { waitForUrl } from './network'
import { repoRoot } from './paths'
import { spawnLogged } from './process'

export const getDocsUrl = (clientPort: number) => `http://127.0.0.1:${clientPort}/docs/`

export const startDocsProcess = async ({
  clientPort,
  env,
  logPath
}: {
  clientPort: number
  env: NodeJS.ProcessEnv
  logPath: string
}): Promise<ChildProcess> => {
  const docsUrl = getDocsUrl(clientPort)
  const childProcess = spawnLogged({
    args: [
      '--filter',
      '@oneworks/docs',
      'dev',
      '--host',
      '127.0.0.1',
      '--port',
      String(clientPort)
    ],
    command: 'pnpm',
    cwd: join(repoRoot, 'assets/homepage'),
    env,
    logPath
  })

  await waitForUrl(docsUrl, `Docs failed to become ready on ${docsUrl}`)
  return childProcess
}
