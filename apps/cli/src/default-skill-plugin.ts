import { createRequire } from 'node:module'
import { dirname } from 'node:path'

import type { PluginConfig } from '@oneworks/types'

const CLI_DEFAULT_SKILL_PLUGIN_ID = '@oneworks/plugin-cli-skills'
const requireFromCliPackage = createRequire(__filename)

const CLI_DEFAULT_SKILL_NAMES = [
  'oneworks-cli-quickstart',
  'oneworks-cli-print-mode',
  'oneworks-channel',
  'oneworks-mem',
  'create-entity',
  'update-entity',
  'create-plugin'
] as const

const resolveCliDefaultSkillPluginRoot = () => (
  dirname(requireFromCliPackage.resolve(`${CLI_DEFAULT_SKILL_PLUGIN_ID}/package.json`))
)

export const getCliDefaultSkillPluginConfig = (): PluginConfig => [
  {
    id: resolveCliDefaultSkillPluginRoot()
  }
]

export const getCliDefaultSkillNames = () => [...CLI_DEFAULT_SKILL_NAMES]
