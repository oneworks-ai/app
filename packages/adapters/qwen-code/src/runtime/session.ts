import type { AdapterCtx, AdapterQueryOptions, AdapterSession } from '@oneworks/types'

import { createDirectQwenSession } from './session/direct'
import { createStreamQwenSession } from './session/stream'

export const createQwenCodeSession = async (
  ctx: AdapterCtx,
  options: AdapterQueryOptions
): Promise<AdapterSession> => (
  options.mode === 'direct' && options.executionProfile !== 'structured_no_tools'
    ? createDirectQwenSession(ctx, options)
    : createStreamQwenSession(ctx, options)
)
