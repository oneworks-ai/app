import { defineAdapterCliPreparer } from '@oneworks/types'

import { ensureGooseCli } from './managed-cli'
import { resolveGooseAdapterConfig } from './runtime/config'

export default defineAdapterCliPreparer({
  adapter: 'goose',
  title: 'Goose',
  targets: [{
    key: 'cli',
    title: 'Goose CLI',
    aliases: ['goose'],
    configPath: ['cli']
  }],
  prepare: async (ctx) => {
    const adapterConfig = resolveGooseAdapterConfig(ctx as Parameters<typeof resolveGooseAdapterConfig>[0])
    return {
      adapter: 'goose',
      target: 'cli',
      title: 'Goose CLI',
      binaryPath: await ensureGooseCli({
        config: adapterConfig.cli,
        ctx: ctx as Parameters<typeof ensureGooseCli>[0]['ctx'],
        defaultSource: 'managed'
      })
    }
  }
})
