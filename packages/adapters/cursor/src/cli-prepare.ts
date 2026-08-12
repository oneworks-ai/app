import { defineAdapterCliPreparer } from '@oneworks/types'

import { ensureCursorCli } from '#~/runtime/init.js'

export default defineAdapterCliPreparer({
  adapter: 'cursor',
  title: 'Cursor',
  targets: [{
    key: 'cli',
    title: 'Cursor Agent CLI',
    aliases: ['agent', 'cursor-agent'],
    configPath: ['cli']
  }],
  prepare: async (ctx) => ({
    adapter: 'cursor',
    target: 'cli',
    title: 'Cursor Agent CLI',
    binaryPath: await ensureCursorCli(ctx as Parameters<typeof ensureCursorCli>[0], {
      defaultSource: 'managed'
    })
  })
})
