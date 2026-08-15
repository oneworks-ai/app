import { ensureCodexCli } from '#~/ensure-cli.js'
import { defineAdapterCliPreparer } from '@oneworks/types'

export default defineAdapterCliPreparer({
  adapter: 'codex',
  title: 'Codex',
  targets: [{
    key: 'cli',
    title: 'Codex CLI',
    aliases: ['codex'],
    configPath: ['cli']
  }],
  prepare: async (ctx) => {
    const binaryPath = await ensureCodexCli(ctx)

    return {
      adapter: 'codex',
      target: 'cli',
      title: 'Codex CLI',
      binaryPath
    }
  }
})
