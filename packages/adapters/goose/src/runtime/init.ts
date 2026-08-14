import type { AdapterCtx } from '@oneworks/types'

import { ensureGooseCli } from '../managed-cli'
import { resolveGooseAdapterConfig } from './config'

export const initGooseAdapter = async (ctx: AdapterCtx) => {
  const config = resolveGooseAdapterConfig(ctx)
  await ensureGooseCli({ config: config.cli, ctx })
}
