import type { AdapterCtx, AdapterQueryOptions, AdapterSession } from '@oneworks/types'

import { createDirectPiSession } from './direct'
import { preparePiSession } from './prepare'
import { createStreamPiSession } from './stream'
import type { PiStreamDependencies } from './stream'

export const createPiSession = async (
  ctx: AdapterCtx,
  options: AdapterQueryOptions,
  dependencies: PiStreamDependencies = {}
): Promise<AdapterSession> => {
  const mode = options.mode === 'direct' ? 'direct' : 'stream'
  const base = await preparePiSession(ctx, options, mode)
  return mode === 'direct'
    ? createDirectPiSession(base, ctx, options, dependencies.spawnProcess)
    : createStreamPiSession(base, ctx, options, dependencies)
}
