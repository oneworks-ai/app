import type { AdapterCtx, AdapterQueryOptions, AdapterSession } from '@oneworks/types'

import { createDirectGrokSession } from './session/direct'
import { createStreamGrokSession } from './session/stream'

export const createGrokSession = async (
  ctx: AdapterCtx,
  options: AdapterQueryOptions
): Promise<AdapterSession> => (
  options.mode === 'direct'
    ? createDirectGrokSession(ctx, options)
    : createStreamGrokSession(ctx, options)
)
