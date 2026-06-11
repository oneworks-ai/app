import { env as processEnv } from 'node:process'

import { FileRuntimeStore } from '@oneworks/runtime-store'

import { migrateRuntimeRoots, resolveLegacyRuntimeRoots, resolveRuntimeRoots } from './discovery.js'
import { resolveSessionRuntimeStoreRoot } from './session-control.js'
import { createWorkspaceRuntimeEnv } from './workspace-env.js'

export async function deleteRuntimeSessionStores(params: {
  cwd?: string
  sessionId: string
}) {
  const env = params.cwd == null ? processEnv : createWorkspaceRuntimeEnv(params.cwd, processEnv)
  await migrateRuntimeRoots({
    ...(params.cwd != null ? { cwd: params.cwd } : {}),
    env
  })
  const roots = new Set(resolveRuntimeRoots({
    ...(params.cwd != null ? { cwd: params.cwd } : {}),
    env
  }))
  for (const legacyRoot of resolveLegacyRuntimeRoots({ ...(params.cwd != null ? { cwd: params.cwd } : {}), env })) {
    roots.add(legacyRoot)
  }
  if (params.cwd != null) {
    roots.add(resolveSessionRuntimeStoreRoot(params.cwd, env))
  }

  await Promise.all(
    Array.from(roots).map(async (root) => {
      const store = new FileRuntimeStore(root)
      await store.deleteSession(params.sessionId)
    })
  )
}
