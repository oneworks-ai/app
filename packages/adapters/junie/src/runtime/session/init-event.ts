import type { AdapterCtx, AdapterOutputEvent, AdapterQueryOptions } from '@oneworks/types'

import { DEFAULT_JUNIE_TOOLS } from '../shared'

export const emitJunieSessionInit = (
  ctx: AdapterCtx,
  options: AdapterQueryOptions,
  emit: (event: AdapterOutputEvent) => void
) => {
  emit({
    type: 'init',
    data: {
      uuid: options.sessionId,
      adapter: 'junie',
      model: options.model ?? 'default',
      effort: options.effort,
      version: '26.8.x (2651.4)',
      tools: DEFAULT_JUNIE_TOOLS,
      slashCommands: [],
      cwd: ctx.cwd,
      agents: [],
      assetDiagnostics: options.assetPlan?.diagnostics
    }
  })
}
