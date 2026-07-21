import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { discoverCodexWorktreeEnvironments } from '../src/runtime/worktree-environment-import'

const tempDirs: string[] = []

const createWorkspace = async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'ow-codex-environment-import-'))
  tempDirs.push(workspace)
  return workspace
}

const writeEnvironment = async (workspace: string, fileName: string, content: string) => {
  const directory = join(workspace, '.codex', 'environments')
  await mkdir(directory, { recursive: true })
  await writeFile(join(directory, fileName), content, 'utf8')
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map(directory => rm(directory, { recursive: true, force: true })))
})

describe('codex worktree environment import', () => {
  it('returns not found when the workspace has no native environments directory', async () => {
    const workspace = await createWorkspace()

    await expect(discoverCodexWorktreeEnvironments({ cwd: workspace, env: {}, source: 'project' })).resolves.toEqual({
      environments: [],
      found: false,
      skippedActionCount: 0,
      skippedEnvironmentCount: 0
    })
  })

  it('maps setup and cleanup scripts, including platform overrides, without importing actions', async () => {
    const workspace = await createWorkspace()
    await writeEnvironment(
      workspace,
      'environment.toml',
      `
version = 1
name = "Node Toolchain"

[setup]
script = """
#!/bin/sh
pnpm install
"""

[setup.darwin]
script = "brew install watchman"

[setup.linux]
script = "sudo apt-get install -y inotify-tools"

[setup.win32]
script = "winget install OpenJS.NodeJS"

[cleanup]
script = "pnpm run cleanup"

[cleanup.win32]
script = "pnpm run cleanup:windows"

[[actions]]
name = "Run dev server"
icon = "run"
command = "pnpm dev"
`
    )

    const result = await discoverCodexWorktreeEnvironments({ cwd: workspace, env: {}, source: 'project' })

    expect(result).toMatchObject({
      found: true,
      skippedEnvironmentCount: 0,
      environments: [{
        displayName: 'Node Toolchain',
        sourceId: 'environment.toml',
        suggestedId: 'node-toolchain',
        scripts: {
          create: '#!/bin/sh\npnpm install\n',
          'create.macos': 'brew install watchman',
          'create.linux': 'sudo apt-get install -y inotify-tools',
          'create.windows': 'winget install OpenJS.NodeJS',
          destroy: 'pnpm run cleanup',
          'destroy.windows': 'pnpm run cleanup:windows'
        }
      }]
    })
    expect(result.skippedActionCount).toBe(1)
    expect(result.environments[0]?.scripts).not.toHaveProperty('start')
    expect(JSON.stringify(result)).not.toContain('pnpm dev')
  })

  it('reports actions from an environment that has no importable lifecycle scripts', async () => {
    const workspace = await createWorkspace()
    await writeEnvironment(
      workspace,
      'environment.toml',
      `
version = 1
name = "Manual only"

[[actions]]
name = "Run dev server"
command = "pnpm dev"
`
    )

    await expect(discoverCodexWorktreeEnvironments({
      cwd: workspace,
      env: {},
      source: 'project'
    })).resolves.toEqual({
      environments: [],
      found: true,
      skippedActionCount: 1,
      skippedEnvironmentCount: 1
    })
  })

  it('fails closed when one lifecycle script is present but exceeds the script limit', async () => {
    const workspace = await createWorkspace()
    await writeEnvironment(
      workspace,
      'environment.toml',
      `
version = 1
name = "Partially unsafe"
[setup]
script = "valid"
[cleanup]
script = "${'x'.repeat(512 * 1024 + 1)}"
`
    )

    await expect(discoverCodexWorktreeEnvironments({
      cwd: workspace,
      env: {},
      source: 'project'
    })).resolves.toEqual({
      environments: [],
      found: true,
      skippedActionCount: 0,
      skippedEnvironmentCount: 1
    })
  })

  it('avoids the reserved local presentation suffix in suggested ids', async () => {
    const workspace = await createWorkspace()
    await writeEnvironment(
      workspace,
      'environment.toml',
      `
version = 1
name = "Node.local"
[setup]
script = "valid"
`
    )

    const result = await discoverCodexWorktreeEnvironments({
      cwd: workspace,
      env: {},
      source: 'project'
    })
    expect(result.environments[0]?.suggestedId).toBe('node-local')
  })

  it('discovers numbered files deterministically and de-duplicates suggested ids', async () => {
    const workspace = await createWorkspace()
    await writeEnvironment(
      workspace,
      'environment.toml',
      `
version = 1
name = "Shared"
[setup]
script = "first"
`
    )
    await writeEnvironment(
      workspace,
      'environment-1.toml',
      `
version = 1
name = "Shared"
[setup]
script = "second"
`
    )
    await writeEnvironment(
      workspace,
      'unrelated.txt',
      `
version = 1
name = "Ignored"
[setup]
script = "ignored"
`
    )

    const result = await discoverCodexWorktreeEnvironments({ cwd: workspace, env: {}, source: 'project' })

    expect(result.environments.map(environment => environment.suggestedId)).toEqual(['shared', 'shared-2'])
    expect(result.environments.map(environment => environment.sourceId)).toEqual([
      'environment.toml',
      'environment-1.toml'
    ])
  })

  it('discovers named native environment toml files', async () => {
    const workspace = await createWorkspace()
    await writeEnvironment(
      workspace,
      'openq4.toml',
      `
name = "OpenQ4"
[setup.win32]
script = "setup-windows"
`
    )

    const result = await discoverCodexWorktreeEnvironments({
      cwd: workspace,
      env: {},
      source: 'project'
    })
    expect(result.environments).toEqual([
      expect.objectContaining({
        sourceId: 'openq4.toml',
        suggestedId: 'openq4',
        scripts: { 'create.windows': 'setup-windows' }
      })
    ])
  })

  it('treats empty base lifecycle scripts as absent when platform overrides are present', async () => {
    const workspace = await createWorkspace()
    await writeEnvironment(
      workspace,
      'platform-only.toml',
      `
version = 1
name = "Platform only"
[setup]
script = ""
[setup.darwin]
script = "setup-macos"
[setup.win32]
script = "setup-windows"
[cleanup]
script = "   "
[cleanup.linux]
script = "cleanup-linux"
`
    )

    const result = await discoverCodexWorktreeEnvironments({ cwd: workspace, env: {}, source: 'project' })

    expect(result.environments[0]?.scripts).toEqual({
      'create.macos': 'setup-macos',
      'create.windows': 'setup-windows',
      'destroy.linux': 'cleanup-linux'
    })
    expect(result.skippedEnvironmentCount).toBe(0)
  })

  it('skips malformed and symlinked environment files without reading the linked target', async () => {
    const workspace = await createWorkspace()
    const outsideDirectory = await mkdtemp(join(tmpdir(), 'ow-codex-environment-outside-'))
    tempDirs.push(outsideDirectory)
    const outsideFile = join(outsideDirectory, 'secret.toml')
    await writeFile(outsideFile, `version = 1\nname = "Secret"\n[setup]\nscript = "secret-value"\n`, 'utf8')
    await writeEnvironment(workspace, 'environment.toml', 'version = [not valid')
    await symlink(outsideFile, join(workspace, '.codex', 'environments', 'environment-2.toml'))

    const result = await discoverCodexWorktreeEnvironments({ cwd: workspace, env: {}, source: 'project' })

    expect(result).toEqual({
      environments: [],
      found: true,
      skippedActionCount: 0,
      skippedEnvironmentCount: 2
    })
    expect(JSON.stringify(result)).not.toContain('secret-value')
  })
})
