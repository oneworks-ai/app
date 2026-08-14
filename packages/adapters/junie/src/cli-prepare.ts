import { defineAdapterCliPreparer } from '@oneworks/types'

import { ensureJunieCli } from './runtime/init'

export default defineAdapterCliPreparer({
  adapter: 'junie',
  title: 'Junie',
  targets: [{
    key: 'cli',
    title: 'JetBrains Junie CLI',
    aliases: ['junie'],
    configPath: ['cli']
  }],
  prepare: async ctx => ({
    adapter: 'junie',
    target: 'cli',
    title: 'JetBrains Junie CLI',
    binaryPath: await ensureJunieCli(ctx as Parameters<typeof ensureJunieCli>[0])
  })
})
