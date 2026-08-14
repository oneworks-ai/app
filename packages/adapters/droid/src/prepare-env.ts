import type { ManagedNpmCliChildEnvPolicy } from '@oneworks/utils/managed-npm-cli'

export const DROID_CLI_PREPARE_CHILD_ENV_POLICY: ManagedNpmCliChildEnvPolicy = {
  mode: 'minimal',
  tombstoneKeys: ['FACTORY_API_KEY', 'FACTORY_TOKEN'],
  tombstonePrefixes: ['FACTORY_']
}
