/* eslint-disable max-lines -- the create/resume fake CLI lifecycle shares one security-sensitive fixture. */
import { Buffer } from 'node:buffer'
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { run } from '#~/run.js'
import type { AdapterOutputEvent } from '@oneworks/types'
import { getCachePath } from '@oneworks/utils/cache'

vi.mock('@oneworks/types/adapter-package', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@oneworks/types/adapter-package')>()
  return {
    ...actual,
    loadAdapter: async (specifier: string) =>
      specifier === 'kiro'
        ? import('../../adapters/kiro/src/index.js').then(module => module.default)
        : actual.loadAdapter(specifier)
  }
})

const fixturePath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'adapters',
  'kiro',
  '__tests__',
  'fixtures',
  'fake-kiro-cli.mjs'
)
let tempRoot = ''

const waitFor = async (condition: () => boolean) => {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (condition()) return
    await new Promise(resolveWait => setTimeout(resolveWait, 10))
  }
  throw new Error('Timed out waiting for Kiro task lifecycle.')
}

const readRegularFilesRecursively = async (root: string): Promise<string[]> => {
  const entries = await readdir(root, { withFileTypes: true })
  const contents: string[] = []
  for (const entry of entries) {
    const entryPath = join(root, entry.name)
    if (entry.isDirectory()) {
      contents.push(...await readRegularFilesRecursively(entryPath))
    } else if (entry.isFile()) {
      contents.push(await readFile(entryPath, 'utf8'))
    }
  }
  return contents
}

const closeLogger = async (stream: NodeJS.WritableStream) => {
  await new Promise<void>((resolveClose, reject) => {
    stream.once('error', reject)
    stream.end(resolveClose)
  })
}

const stopAndClose = async (
  result: Awaited<ReturnType<typeof run>>,
  events: AdapterOutputEvent[]
) => {
  result.session.stop?.()
  await waitFor(() => events.some(event => event.type === 'exit'))
  await result.session.flushHooks?.()
  await closeLogger(result.ctx.logger.stream)
}

const runPermissionPhase = async (params: {
  contract?: string
  ctxId: string
  decision: string
  logPath: string
  projectRoot: string
  sessionId: string
  type: 'create' | 'resume'
}) => {
  const events: AdapterOutputEvent[] = []
  const result = await run({
    adapter: 'kiro',
    ctxId: params.ctxId,
    cwd: params.projectRoot,
    env: {
      __ONEWORKS_PROJECT_ADAPTER_KIRO_CLI_PATH__: fixturePath,
      __ONEWORKS_PROJECT_HOME_PROJECTS_DIR__: join(tempRoot, `${params.ctxId}-projects-home`),
      __ONEWORKS_PROJECT_PACKAGE_CACHE_DIR__: join(tempRoot, `${params.ctxId}-package-cache`),
      FAKE_KIRO_BEHAVIOR: 'permission',
      FAKE_KIRO_LOG: params.logPath,
      FAKE_KIRO_PERMISSION_CONTRACT: params.contract ?? 'full'
    }
  }, {
    type: params.type,
    runtime: 'server',
    sessionId: params.sessionId,
    permissionMode: 'default',
    description: `${params.type} permission memory contract`,
    model: 'default',
    useDefaultOneworksMcpServer: false,
    onEvent: event => events.push(event)
  })
  await waitFor(() => events.some(event => event.type === 'interaction_request'))
  const interaction = events.find(event => event.type === 'interaction_request')
  if (interaction?.type !== 'interaction_request') throw new Error('Expected task permission request')
  await result.session.respondInteraction?.(interaction.data.id, params.decision)
  await waitFor(() => events.some(event => event.type === 'stop'))
  expect(events.filter(event => event.type === 'stop')).toHaveLength(1)
  await stopAndClose(result, events)
}

const configVariable = (name: string) => ['$', '{', name, '}'].join('')

const fullyPercentEncode = (value: string) =>
  [...Buffer.from(value, 'utf8')]
    .map((byte, index) => {
      const hex = byte.toString(16).padStart(2, '0')
      return `%${index % 2 === 0 ? hex.toUpperCase() : hex.toLowerCase()}`
    })
    .join('')

const writeKiroCredentialFixtureConfig = async (projectRoot: string, secret: string, shortSecret: string) => {
  const fullyEncodedSecret = fullyPercentEncode(secret)
  const base64Secret = Buffer.from(secret, 'utf8').toString('base64')
  await writeFile(
    join(projectRoot, '.oo.config.json'),
    JSON.stringify(
      {
        disableGlobalConfig: true,
        adapters: {
          kiro: {
            configContent: {
              safePropertyName: 'safe-property-value',
              [`header-${secret}`]: 'raw-secret-key',
              [`encoded-${encodeURIComponent(secret)}`]: 'encoded-secret-key',
              [`fully-${fullyEncodedSecret}`]: 'fully-encoded-secret-key',
              [`base64-${base64Secret}`]: 'base64-secret-key',
              [`short-${shortSecret}`]: 'short-secret-key',
              authHeader: `Bearer ${configVariable('KIRO_API_KEY')}`,
              endpoint: `https://example.test/mcp?token=${encodeURIComponent(secret)}`,
              fullyEncodedEndpoint: `https://example.test/mcp?token=${fullyEncodedSecret}`,
              nestedEncodedEndpoint: `next=${encodeURIComponent(fullyEncodedSecret)}`,
              malformedEncodedEndpoint: `%QZ&token=${fullyEncodedSecret}`,
              nested: [
                { base64: Buffer.from(secret, 'utf8').toString('base64') },
                { urlBase64: Buffer.from(secret, 'utf8').toString('base64url') },
                { shortSecret: `prefix-${shortSecret}-suffix` },
                { emptySecretControl: 'safe-empty-control' }
              ],
              AWS_CONTAINER_CREDENTIALS_RELATIVE_URI: configVariable('AWS_CONTAINER_CREDENTIALS_RELATIVE_URI'),
              AWS_SHARED_CREDENTIALS_FILE: configVariable('AWS_SHARED_CREDENTIALS_FILE'),
              AWS_CONFIG_FILE: configVariable('AWS_CONFIG_FILE')
            }
          }
        }
      },
      null,
      2
    ),
    'utf8'
  )
}

beforeAll(async () => {
  tempRoot = await mkdtemp(join(tmpdir(), 'oneworks-kiro-task-integration-'))
  await chmod(fixturePath, 0o755)
})

afterAll(async () => {
  await rm(tempRoot, { recursive: true, force: true })
})

describe('kiro task automation integration', () => {
  it('returns create/resume task sessions before initial default/plan permission input', async () => {
    const projectRoot = join(tempRoot, 'interactive-project')
    const logPath = join(tempRoot, 'interactive-wire.jsonl')
    const ctxId = 'ctx-kiro-interactive-initial'
    const sessionId = 'session-kiro-interactive-initial'
    await mkdir(projectRoot, { recursive: true })
    await writeFile(join(projectRoot, '.oo.config.json'), JSON.stringify({ disableGlobalConfig: true }))
    const baseEnv = {
      __ONEWORKS_PROJECT_ADAPTER_KIRO_CLI_PATH__: fixturePath,
      __ONEWORKS_PROJECT_HOME_PROJECTS_DIR__: join(tempRoot, 'interactive-projects-home'),
      __ONEWORKS_PROJECT_PACKAGE_CACHE_DIR__: join(tempRoot, 'interactive-package-cache'),
      __ONEWORKS_PROJECT_REAL_HOME__: join(tempRoot, 'interactive-real-home'),
      FAKE_KIRO_BEHAVIOR: 'permission',
      FAKE_KIRO_LOG: logPath
    }

    for (
      const testCase of [
        { type: 'create' as const, permissionMode: 'default' as const },
        { type: 'resume' as const, permissionMode: 'plan' as const }
      ]
    ) {
      const events: AdapterOutputEvent[] = []
      const result = await run({
        adapter: 'kiro',
        ctxId,
        cwd: projectRoot,
        env: baseEnv
      }, {
        type: testCase.type,
        runtime: 'server',
        sessionId,
        permissionMode: testCase.permissionMode,
        description: `${testCase.type} initial permissioned task`,
        model: 'default',
        useDefaultOneworksMcpServer: false,
        onEvent: event => events.push(event)
      })

      expect(events.filter(event => event.type === 'interaction_request')).toHaveLength(0)
      await waitFor(() => events.some(event => event.type === 'interaction_request'))
      const interaction = events.find(event => event.type === 'interaction_request')
      if (interaction?.type !== 'interaction_request') throw new Error('Expected task permission request')
      await result.session.respondInteraction?.(interaction.data.id, 'allow_once')
      await waitFor(() => events.some(event => event.type === 'stop'))
      expect(events.filter(event => event.type === 'stop')).toHaveLength(1)
      await stopAndClose(result, events)
    }

    const records = (await readFile(logPath, 'utf8')).trim().split('\n').map(line => JSON.parse(line))
    expect(records.map(record => record.method)).toEqual(expect.arrayContaining(['session/new', 'session/load']))
    expect(records.filter(record => record.id === 'permission-1' && record.result != null)).toHaveLength(2)
    expect(records.filter(record => record.id === 'permission-1' && record.result != null)).toEqual([
      expect.objectContaining({ result: { outcome: { outcome: 'selected', optionId: 'allow-once' } } }),
      expect.objectContaining({ result: { outcome: { outcome: 'selected', optionId: 'allow-once' } } })
    ])
    expect(await readFile(logPath, 'utf8')).not.toContain('initial permissioned task')
  }, 30_000)

  it('keeps remembered and explicit persistent permission scope truthful across create/resume', async () => {
    const cases = [
      {
        name: 'remembered-allow',
        phases: [
          { type: 'create' as const, decision: 'allow_session', expected: 'allow-once' },
          { type: 'resume' as const, decision: 'allow_project', expected: 'allow-once' }
        ]
      },
      {
        name: 'remembered-deny',
        phases: [
          { type: 'create' as const, decision: 'deny_session', expected: 'reject-once' },
          { type: 'resume' as const, decision: 'deny_project', expected: 'reject-once' }
        ]
      },
      {
        name: 'missing-request-scope',
        phases: [
          {
            type: 'create' as const,
            contract: 'allow-persistent-only',
            decision: 'allow_session',
            expected: undefined
          },
          {
            type: 'resume' as const,
            contract: 'deny-persistent-only',
            decision: 'deny_project',
            expected: undefined
          }
        ]
      },
      {
        name: 'explicit-native-persistent',
        phases: [
          { type: 'create' as const, decision: 'allow-always', expected: 'allow-always' },
          { type: 'resume' as const, decision: 'reject-always', expected: 'reject-always' }
        ]
      }
    ]

    for (const testCase of cases) {
      const projectRoot = join(tempRoot, `permission-${testCase.name}`)
      const logPath = join(projectRoot, 'wire.jsonl')
      const ctxId = `ctx-${testCase.name}`
      const sessionId = `session-${testCase.name}`
      await mkdir(projectRoot, { recursive: true })
      await writeFile(join(projectRoot, '.oo.config.json'), JSON.stringify({ disableGlobalConfig: true }))
      for (const phase of testCase.phases) {
        await runPermissionPhase({
          ...phase,
          ctxId,
          logPath,
          projectRoot,
          sessionId
        })
      }

      const records = (await readFile(logPath, 'utf8')).trim().split('\n').map(line => JSON.parse(line))
      const permissionResponses = records.filter(record => record.id === 'permission-1' && record.result != null)
      expect(permissionResponses).toHaveLength(2)
      expect(permissionResponses.map(record => record.result)).toEqual(
        testCase.phases.map(phase =>
          phase.expected == null
            ? { outcome: { outcome: 'cancelled' } }
            : { outcome: { outcome: 'selected', optionId: phase.expected } }
        )
      )
      expect(records.map(record => record.method)).toEqual(expect.arrayContaining(['session/new', 'session/load']))
    }
  }, 60_000)

  it('carries dontAsk through create/resume while all Kiro/AWS provider credentials stay process-only', async () => {
    const projectRoot = join(tempRoot, 'project')
    const logPath = join(tempRoot, 'wire.jsonl')
    const ctxId = 'ctx-kiro-task-integration'
    const sessionId = 'session-kiro-task-integration'
    await mkdir(projectRoot, { recursive: true })
    const createSecret = 'create secret/+?not-for-disk'
    const resumeSecret = 'resume secret/+?not-for-disk'
    const shortSecret = 's7h0rt!'
    const createProviderSecrets = {
      AWS_BEARER_TOKEN_BEDROCK: 'bedrock-bearer-secret-not-for-disk',
      AWS_WEB_IDENTITY_TOKEN_FILE: '/runtime-only/web-identity-token-file',
      AWS_CONTAINER_CREDENTIALS_RELATIVE_URI: '/v2/credentials/runtime-only-provider',
      AWS_CONTAINER_CREDENTIALS_FULL_URI: 'http://169.254.170.2/runtime-only-provider',
      AWS_CONTAINER_AUTHORIZATION_TOKEN: 'container-authorization-secret-not-for-disk',
      AWS_CONTAINER_AUTHORIZATION_TOKEN_FILE: '/runtime-only/container-authorization-token-file',
      AWS_SHARED_CREDENTIALS_FILE: '/runtime-only/create-shared-credentials',
      AWS_CONFIG_FILE: '/runtime-only/create-aws-config'
    }
    const resumeProviderSecrets = {
      ...createProviderSecrets,
      AWS_SHARED_CREDENTIALS_FILE: '/runtime-only/resume-shared-credentials',
      AWS_CONFIG_FILE: '/runtime-only/resume-aws-config'
    }
    const providerNames = Object.keys(createProviderSecrets)
    await writeKiroCredentialFixtureConfig(projectRoot, createSecret, shortSecret)
    const baseEnv = {
      __ONEWORKS_PROJECT_ADAPTER_KIRO_CLI_PATH__: fixturePath,
      __ONEWORKS_PROJECT_HOME_PROJECTS_DIR__: join(tempRoot, 'projects-home'),
      __ONEWORKS_PROJECT_PACKAGE_CACHE_DIR__: join(tempRoot, 'package-cache'),
      __ONEWORKS_PROJECT_REAL_HOME__: join(tempRoot, 'real-home'),
      FAKE_KIRO_BEHAVIOR: 'permission',
      FAKE_KIRO_LOG: logPath,
      RESUME_RUNTIME_MARKER: 'non-secret-resume-state',
      AWS_REGION: 'us-west-2',
      AWS_PROFILE: 'resume-profile',
      KIRO_SHORT_TOKEN: shortSecret,
      KIRO_EMPTY_TOKEN: ''
    }
    const events: AdapterOutputEvent[] = []

    const createResult = await run({
      adapter: 'kiro',
      ctxId,
      cwd: projectRoot,
      env: {
        ...baseEnv,
        ...createProviderSecrets,
        FAKE_KIRO_PHASE: 'create',
        KIRO_API_KEY: createSecret,
        KIRO_TEST_EXPECTED_API_KEY: createSecret
      }
    }, {
      type: 'create',
      runtime: 'server',
      sessionId,
      permissionMode: 'dontAsk',
      description: 'run a permissioned tool during create',
      model: 'default',
      useDefaultOneworksMcpServer: false,
      onEvent: event => events.push(event)
    })
    expect(events.filter(event => event.type === 'interaction_request')).toHaveLength(0)
    await waitFor(() => events.some(event => event.type === 'stop'))
    expect(events.filter(event => event.type === 'stop')).toHaveLength(1)
    createResult.session.stop?.()
    await waitFor(() => events.some(event => event.type === 'exit'))
    await createResult.session.flushHooks?.()
    createResult.ctx.logger.warn({
      [`header-${createSecret}`]: 'secret-property-name',
      [`encoded-${encodeURIComponent(createSecret)}`]: 'encoded-secret-property-name',
      Authorization: `Bearer ${createSecret}`,
      nested: [encodeURIComponent(createSecret), Buffer.from(createSecret).toString('base64')],
      short: `prefix-${shortSecret}-suffix`,
      provider: createProviderSecrets.AWS_CONTAINER_AUTHORIZATION_TOKEN,
      fullyEncoded: fullyPercentEncode(createSecret),
      nestedEncoded: encodeURIComponent(fullyPercentEncode(createSecret)),
      malformedEncoded: `%QZ&token=${fullyPercentEncode(createSecret)}`
    }, '[kiro-test] persistence redaction snapshot')
    await closeLogger(createResult.ctx.logger.stream)
    const basePath = getCachePath(projectRoot, ctxId, sessionId, 'base', baseEnv)
    const createBase = JSON.parse(await readFile(basePath, 'utf8')) as { env: Record<string, string> }
    createBase.env.AWS_SHARED_CREDENTIALS_FILE = '/stale/cached/shared-credentials'
    createBase.env.AWS_CONFIG_FILE = '/stale/cached/aws-config'
    await writeFile(basePath, JSON.stringify(createBase), 'utf8')
    const staleNativeSecret = 'stale-native-setting-secret-not-for-disk'
    await writeFile(
      join(dirname(basePath), 'adapter-kiro', 'kiro-home', 'settings', 'cli.json'),
      JSON.stringify({ staleHeader: `Bearer ${staleNativeSecret}` }),
      'utf8'
    )

    const resumeEvents: AdapterOutputEvent[] = []
    await writeKiroCredentialFixtureConfig(projectRoot, resumeSecret, shortSecret)
    const resumeResult = await run({
      adapter: 'kiro',
      ctxId,
      cwd: projectRoot,
      env: {
        ...baseEnv,
        ...resumeProviderSecrets,
        FAKE_KIRO_PHASE: 'resume',
        KIRO_API_KEY: resumeSecret,
        KIRO_TEST_EXPECTED_API_KEY: resumeSecret
      }
    }, {
      type: 'resume',
      runtime: 'server',
      sessionId,
      permissionMode: 'dontAsk',
      description: 'run a permissioned tool during resume',
      model: 'default',
      useDefaultOneworksMcpServer: false,
      onEvent: event => resumeEvents.push(event)
    })
    expect(resumeEvents.filter(event => event.type === 'interaction_request')).toHaveLength(0)
    await waitFor(() => resumeEvents.some(event => event.type === 'stop'))
    expect(resumeEvents.filter(event => event.type === 'stop')).toHaveLength(1)

    const wire = await readFile(logPath, 'utf8')
    const records = wire.trim().split('\n').map(line => JSON.parse(line))
    expect(records.filter(record => record.type === 'environment')).toEqual([
      expect.objectContaining({ credentialMatchesExpected: true, runtimeMarker: 'non-secret-resume-state' }),
      expect.objectContaining({ credentialMatchesExpected: true, runtimeMarker: 'non-secret-resume-state' })
    ])
    expect(records.filter(record => record.type === 'environment')).toEqual([
      expect.objectContaining({
        credentialProviderPresence: Object.fromEntries(providerNames.map(name => [name, true])),
        credentialLocatorMatchesExpected: { config: true, sharedCredentials: true }
      }),
      expect.objectContaining({
        credentialProviderPresence: Object.fromEntries(providerNames.map(name => [name, true])),
        credentialLocatorMatchesExpected: { config: true, sharedCredentials: true }
      })
    ])
    expect(records.filter(record => record.id === 'permission-1')).toEqual(expect.arrayContaining([
      expect.objectContaining({
        result: { outcome: { outcome: 'selected', optionId: 'allow-once' } }
      })
    ]))
    expect(wire).not.toContain(createSecret)
    expect(wire).not.toContain(resumeSecret)
    expect(wire).not.toContain('run a permissioned tool')
    for (
      const locator of [
        createProviderSecrets.AWS_SHARED_CREDENTIALS_FILE,
        createProviderSecrets.AWS_CONFIG_FILE,
        resumeProviderSecrets.AWS_SHARED_CREDENTIALS_FILE,
        resumeProviderSecrets.AWS_CONFIG_FILE,
        '/stale/cached/shared-credentials',
        '/stale/cached/aws-config'
      ]
    ) expect(wire).not.toContain(locator)

    const persistedBase = await readFile(basePath, 'utf8')
    expect(persistedBase).toContain('non-secret-resume-state')
    expect(persistedBase).toContain('us-west-2')
    expect(persistedBase).toContain('resume-profile')
    expect(persistedBase).toContain('safe-empty-control')
    expect(persistedBase).not.toContain('KIRO_API_KEY')
    expect(persistedBase).not.toContain('KIRO_TEST_EXPECTED_API_KEY')
    for (const name of providerNames) expect(persistedBase).not.toContain(name)
    expect(persistedBase).not.toContain('/stale/cached/shared-credentials')
    expect(persistedBase).not.toContain('/stale/cached/aws-config')

    resumeResult.session.stop?.()
    await waitFor(() => resumeEvents.some(event => event.type === 'exit'))
    await resumeResult.session.flushHooks?.()
    resumeResult.ctx.logger.warn({
      [`header-${resumeSecret}`]: 'secret-property-name',
      [`encoded-${fullyPercentEncode(resumeSecret)}`]: 'encoded-secret-property-name',
      Authorization: `Bearer ${resumeSecret}`,
      query: encodeURIComponent(resumeSecret),
      base64: Buffer.from(resumeSecret).toString('base64'),
      fullyEncoded: fullyPercentEncode(resumeSecret),
      nestedEncoded: encodeURIComponent(fullyPercentEncode(resumeSecret)),
      malformedEncoded: `%QZ&token=${fullyPercentEncode(resumeSecret)}`
    }, '[kiro-test] resume persistence redaction snapshot')
    await closeLogger(resumeResult.ctx.logger.stream)

    const persistedDisk = (await readRegularFilesRecursively(baseEnv.__ONEWORKS_PROJECT_HOME_PROJECTS_DIR__)).join('\n')
    const forbiddenValues = [
      createSecret,
      resumeSecret,
      encodeURIComponent(createSecret),
      encodeURIComponent(resumeSecret),
      Buffer.from(createSecret).toString('base64'),
      Buffer.from(resumeSecret).toString('base64'),
      fullyPercentEncode(createSecret),
      fullyPercentEncode(resumeSecret),
      encodeURIComponent(fullyPercentEncode(createSecret)),
      encodeURIComponent(fullyPercentEncode(resumeSecret)),
      shortSecret,
      staleNativeSecret,
      '/stale/cached/shared-credentials',
      '/stale/cached/aws-config',
      ...Object.values(createProviderSecrets),
      ...Object.values(resumeProviderSecrets)
    ]
    for (const forbidden of forbiddenValues) expect(persistedDisk).not.toContain(forbidden)
    for (const name of providerNames) expect(persistedDisk).not.toContain(name)
    expect(persistedDisk).toContain('non-secret-resume-state')
    expect(persistedDisk).toContain('us-west-2')
    expect(persistedDisk).toContain('resume-profile')
    expect(persistedDisk).toContain('safe-empty-control')
    expect(persistedDisk).toContain('safePropertyName')
    expect(persistedDisk).toContain('safe-property-value')
  }, 30_000)
})
