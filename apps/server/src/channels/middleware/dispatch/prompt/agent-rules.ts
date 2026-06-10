import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { cwd, env } from 'node:process'

import { resolveProjectOoPath } from '@oneworks/utils'

/**
 * Tries to load `AGENTS.channel.<channelType>.md` from:
 *   1. <projectRoot>/.oo/rules/AGENTS.channel.<channelType>.md
 *   2. <projectRoot>/AGENTS.channel.<channelType>.md (legacy fallback)
 * Returns the first file found, or undefined.
 */
export const loadChannelAgentRules = async (channelType: string): Promise<string | undefined> => {
  const filename = `AGENTS.channel.${channelType}.md`
  const root = env.__ONEWORKS_PROJECT_WORKSPACE_FOLDER__ ?? cwd()
  const candidates = [
    resolveProjectOoPath(root, env, 'rules', filename),
    join(root, filename)
  ]
  for (const candidate of candidates) {
    try {
      const content = await readFile(candidate, 'utf8')
      if (content.trim()) return content.trim()
    } catch {
      // file not found — try next candidate
    }
  }
  return undefined
}
