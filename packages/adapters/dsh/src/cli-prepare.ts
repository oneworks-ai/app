import { defineAdapterCliPreparer } from '@oneworks/types'

import { ensureDshCli } from './runtime/install'

export default defineAdapterCliPreparer({
  adapter: 'dsh',
  title: 'DSH',
  targets: [{
    key: 'cli',
    title: 'DeepSeek Harness ACP',
    aliases: ['dsh-acp-demo'],
    configPath: ['cli']
  }],
  prepare: async (ctx) => ({
    adapter: 'dsh',
    target: 'cli',
    title: 'DeepSeek Harness ACP',
    binaryPath: await ensureDshCli(ctx as Parameters<typeof ensureDshCli>[0], { defaultSource: 'managed' })
  })
})
