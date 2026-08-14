import type { AdapterCtx, AdapterQueryOptions, AdapterSession } from '@oneworks/types'

import { createDirectJunieSession } from './session/direct'
import { createStreamJunieSession } from './session/stream'

export const createJunieSession = async (
  ctx: AdapterCtx,
  options: AdapterQueryOptions
): Promise<AdapterSession> => (
  options.mode === 'direct'
    ? createDirectJunieSession(ctx, options)
    : createStreamJunieSession(ctx, options)
)
