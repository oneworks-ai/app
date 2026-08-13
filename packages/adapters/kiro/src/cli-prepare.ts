import { defineAdapterCliPreparer } from '@oneworks/types'

import { ensureKiroCli } from '#~/runtime/init.js'

export default defineAdapterCliPreparer({
  adapter: 'kiro',
  title: 'Kiro',
  targets: [{
    key: 'cli',
    title: 'Kiro CLI',
    aliases: ['kiro-cli', 'q'],
    configPath: ['cli']
  }],
  prepare: async ctx => ({
    adapter: 'kiro',
    target: 'cli',
    title: 'Kiro CLI',
    binaryPath: await ensureKiroCli(ctx as Parameters<typeof ensureKiroCli>[0], {
      defaultSource: 'managed'
    })
  })
})
