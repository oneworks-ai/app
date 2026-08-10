import { execFileSync, spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

const temporaryDirectories: string[] = []
const ignoreScript = path.resolve(process.cwd(), 'scripts/vercel-ignore-build.mjs')

const git = (cwd: string, args: string[]) =>
  execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()

const classifyRelayServerChange = (repository: string, base: string, head: string) =>
  spawnSync(
    process.execPath,
    [ignoreScript, 'relay-server', '--base', base, '--head', head],
    { cwd: repository, encoding: 'utf8' }
  )

const createRepository = async () => {
  const repository = await mkdtemp(path.join(tmpdir(), 'oneworks-vercel-ignore-'))
  temporaryDirectories.push(repository)
  git(repository, ['init'])
  git(repository, ['config', 'user.email', 'test@example.com'])
  git(repository, ['config', 'user.name', 'OneWorks Test'])
  await writeFile(path.join(repository, 'README.md'), 'fixture\n')
  git(repository, ['add', '.'])
  git(repository, ['commit', '-m', 'test: initialize fixture'])
  return repository
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map(directory => rm(directory, { force: true, recursive: true }))
  )
})

describe('vercel ignore build', () => {
  it('continues the Relay Server build when a packaging script changes', async () => {
    const repository = await createRepository()
    const base = git(repository, ['rev-parse', 'HEAD'])
    const scriptDirectory = path.join(repository, 'apps', 'relay-server', 'scripts')
    await mkdir(scriptDirectory, { recursive: true })
    await writeFile(path.join(scriptDirectory, 'materialize-vercel-runtime.mjs'), 'export {}\n')
    git(repository, ['add', '.'])
    git(repository, ['commit', '-m', 'test: change Relay packaging'])
    const head = git(repository, ['rev-parse', 'HEAD'])

    const result = classifyRelayServerChange(repository, base, head)

    expect(result.status).toBe(1)
    expect(result.stdout).toContain(
      'relay-server build required; apps/relay-server/scripts/materialize-vercel-runtime.mjs changed'
    )
  })

  it('continues the Relay Server build when a packaging script is deleted', async () => {
    const repository = await createRepository()
    const scriptDirectory = path.join(repository, 'apps', 'relay-server', 'scripts')
    const scriptPath = path.join(scriptDirectory, 'materialize-vercel-runtime.mjs')
    await mkdir(scriptDirectory, { recursive: true })
    await writeFile(scriptPath, 'export {}\n')
    git(repository, ['add', '.'])
    git(repository, ['commit', '-m', 'test: add Relay packaging'])
    const base = git(repository, ['rev-parse', 'HEAD'])
    await rm(scriptPath)
    git(repository, ['add', '--all'])
    git(repository, ['commit', '-m', 'test: remove Relay packaging'])
    const head = git(repository, ['rev-parse', 'HEAD'])

    const result = classifyRelayServerChange(repository, base, head)

    expect(result.status).toBe(1)
    expect(result.stdout).toContain(
      'relay-server build required; apps/relay-server/scripts/materialize-vercel-runtime.mjs changed'
    )
  })

  it('continues the Relay Server build when shared runtime types change', async () => {
    const repository = await createRepository()
    const base = git(repository, ['rev-parse', 'HEAD'])
    const typesDirectory = path.join(repository, 'packages', 'types', 'src')
    await mkdir(typesDirectory, { recursive: true })
    await writeFile(path.join(typesDirectory, 'credential-revision.ts'), 'export const revision = 1\n')
    git(repository, ['add', '.'])
    git(repository, ['commit', '-m', 'test: change shared runtime types'])
    const head = git(repository, ['rev-parse', 'HEAD'])

    const result = classifyRelayServerChange(repository, base, head)

    expect(result.status).toBe(1)
    expect(result.stdout).toContain(
      'relay-server build required; packages/types/src/credential-revision.ts changed'
    )
  })

  it('skips test-only changes inside the Relay Server scripts directory', async () => {
    const repository = await createRepository()
    const base = git(repository, ['rev-parse', 'HEAD'])
    const scriptDirectory = path.join(repository, 'apps', 'relay-server', 'scripts')
    await mkdir(scriptDirectory, { recursive: true })
    await writeFile(path.join(scriptDirectory, 'materialize-vercel-runtime.spec.ts'), 'export {}\n')
    git(repository, ['add', '.'])
    git(repository, ['commit', '-m', 'test: cover Relay packaging'])
    const head = git(repository, ['rev-parse', 'HEAD'])

    const result = classifyRelayServerChange(repository, base, head)

    expect(result.status).toBe(0)
    expect(result.stdout).toContain('no relay-server deployment paths changed')
  })

  it('still skips documentation-only Relay Server changes', async () => {
    const repository = await createRepository()
    const base = git(repository, ['rev-parse', 'HEAD'])
    const relayDirectory = path.join(repository, 'apps', 'relay-server')
    await mkdir(relayDirectory, { recursive: true })
    await writeFile(path.join(relayDirectory, 'README.md'), 'documentation only\n')
    git(repository, ['add', '.'])
    git(repository, ['commit', '-m', 'docs: update Relay guide'])
    const head = git(repository, ['rev-parse', 'HEAD'])

    const result = classifyRelayServerChange(repository, base, head)

    expect(result.status).toBe(0)
    expect(result.stdout).toContain('no relay-server deployment paths changed')
  })
})
