import type {
  AdapterWorktreeEnvironmentImportCapability,
  AdapterWorktreeEnvironmentImportSource
} from '@oneworks/types'

import { discoverCodexWorktreeEnvironments } from './runtime/worktree-environment-import'

export { discoverCodexWorktreeEnvironments } from './runtime/worktree-environment-import'

export const worktreeEnvironmentImport = {
  descriptor: {
    title: 'Codex environments',
    description: 'Import native Codex local environments into One Works worktree environments.',
    supportedSources: [
      'project',
      'user'
    ] as const satisfies readonly AdapterWorktreeEnvironmentImportSource[]
  },
  discover: discoverCodexWorktreeEnvironments
} satisfies AdapterWorktreeEnvironmentImportCapability

export default worktreeEnvironmentImport
