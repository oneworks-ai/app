/* eslint-disable max-lines -- Live Relay smoke intentionally keeps the user journey in one executable file. */
import { Buffer } from 'node:buffer'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import type { Server } from 'node:http'
import { createRequire } from 'node:module'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import process from 'node:process'

type ConfigApi = Pick<typeof import('../packages/config/src/index'), 'loadConfigState' | 'resetConfigCache'>
type ConfigState = Awaited<ReturnType<ConfigApi['loadConfigState']>>
type JsonRecord = Record<string, unknown>

interface RelayServerArgsLike {
  adminToken: string
  allowOrigin?: string
  dataPath: string
  deviceMetadataSecret?: string
  host: string
  port: number
  publicBaseUrl?: string
}

interface RelayServerModule {
  createRelayServer: (args: RelayServerArgsLike) => Server
  parseRelayServerArgs: (argv: string[], env?: Record<string, string | undefined>) => RelayServerArgsLike
}

export interface RelayConfigLiveSmokeOptions {
  json?: boolean
  keepTemp?: boolean
  repoRoot?: string
  skipAdminBuild?: boolean
}

export interface RelayConfigLiveSmokeResult {
  adminAssetBytes: {
    css: number
    js: number
  }
  adminShellOk: boolean
  assignmentId: string
  checks: Record<string, boolean>
  profileId: string
  projectHome: string
  relayUrl: string
  snapshotHash: string
  teamId: string
  tempRoot: string
  workspaceDir: string
  ok: true
}

const LIVE_SERVICE_KEY = 'relay-live'
const LIVE_MODEL = 'relay-live-model'
const LIVE_PLUGIN_ID = '@oneworks/plugin-demo'
const LIVE_SKILL_ID = 'relay-live-skill'
const LIVE_PROJECT_ID = 'customer-live'
const LIVE_DEVICE_ID = 'member-device-live'
const LIVE_SECRET_VALUE = 'sk-live-smoke-secret'
const LIVE_SECRET_REF = `modelServices.${LIVE_SERVICE_KEY}.apiKey`

const snapshotRelativePath = ['.local', 'plugins', 'relay', 'config-snapshot.json'] as const

const isRecord = (value: unknown): value is JsonRecord => (
  value != null && typeof value === 'object' && !Array.isArray(value)
)

function assertCondition(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

const cleanErrorBody = (value: unknown) => {
  const text = JSON.stringify(value)
  return text.replaceAll(LIVE_SECRET_VALUE, '<redacted-live-smoke-secret>')
}

const writeJson = async (filePath: string, value: unknown) => {
  await mkdir(dirname(filePath), { recursive: true })
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

const runCommand = async (input: {
  args: string[]
  command: string
  cwd: string
  env?: NodeJS.ProcessEnv
  passthroughStdIO: boolean
  timeoutMs: number
}) => {
  const child = spawn(input.command, input.args, {
    cwd: input.cwd,
    env: input.env ?? process.env,
    stdio: ['ignore', 'pipe', 'pipe']
  })
  const stdoutChunks: Buffer[] = []
  const stderrChunks: Buffer[] = []
  let timedOut = false

  child.stdout.on('data', (chunk: Buffer) => {
    stdoutChunks.push(chunk)
    if (input.passthroughStdIO) process.stdout.write(chunk)
  })
  child.stderr.on('data', (chunk: Buffer) => {
    stderrChunks.push(chunk)
    if (input.passthroughStdIO) process.stderr.write(chunk)
  })

  const timeout = setTimeout(() => {
    timedOut = true
    child.kill('SIGTERM')
  }, input.timeoutMs)

  return await new Promise<{
    code: number
    stderr: string
    stdout: string
    timedOut: boolean
  }>((resolvePromise, reject) => {
    child.once('error', reject)
    child.once('close', code => {
      if (timeout != null) clearTimeout(timeout)
      resolvePromise({
        code: code ?? (timedOut ? -1 : 0),
        stderr: Buffer.concat(stderrChunks).toString('utf8'),
        stdout: Buffer.concat(stdoutChunks).toString('utf8'),
        timedOut
      })
    })
  })
}

const buildRelayAdmin = async (repoRoot: string, json: boolean) => {
  const result = await runCommand({
    args: ['-C', 'apps/relay-admin', 'build'],
    command: 'pnpm',
    cwd: repoRoot,
    passthroughStdIO: !json,
    timeoutMs: 120_000
  })
  if (result.code !== 0) {
    throw new Error(
      [
        'Relay Admin build failed before live smoke.',
        `exitCode=${result.code}`,
        result.timedOut ? 'timedOut=true' : undefined,
        result.stdout.trim() === '' ? undefined : `stdout:\n${result.stdout}`,
        result.stderr.trim() === '' ? undefined : `stderr:\n${result.stderr}`
      ].filter(Boolean).join('\n')
    )
  }
}

const buildRelayServer = async (repoRoot: string, json: boolean) => {
  const result = await runCommand({
    args: ['-C', 'apps/relay-server', 'build'],
    command: 'pnpm',
    cwd: repoRoot,
    passthroughStdIO: !json,
    timeoutMs: 120_000
  })
  if (result.code !== 0) {
    throw new Error(
      [
        'Relay Server build failed before live smoke.',
        `exitCode=${result.code}`,
        result.timedOut ? 'timedOut=true' : undefined,
        result.stdout.trim() === '' ? undefined : `stdout:\n${result.stdout}`,
        result.stderr.trim() === '' ? undefined : `stderr:\n${result.stderr}`
      ].filter(Boolean).join('\n')
    )
  }
}

const loadRelayServerModule = (repoRoot: string): RelayServerModule => {
  const repoRequire = createRequire(resolve(repoRoot, 'package.json'))
  return repoRequire(resolve(repoRoot, 'apps/relay-server/dist/server.js')) as RelayServerModule
}

const closeServer = async (server: Server) =>
  await new Promise<void>((resolvePromise, reject) => {
    server.close(error => {
      if (error == null) resolvePromise()
      else reject(error)
    })
  })

const listenServer = async (server: Server, host: string, port: number) => {
  await new Promise<void>(resolvePromise => server.listen(port, host, resolvePromise))
  const address = server.address() as AddressInfo
  return `http://${host}:${address.port}`
}

const requestJson = async <T extends JsonRecord = JsonRecord>(
  relayUrl: string,
  path: string,
  init: RequestInit = {}
): Promise<T> => {
  const response = await fetch(`${relayUrl}${path}`, {
    ...init,
    headers: {
      ...(init.body == null ? {} : { 'content-type': 'application/json' }),
      ...(init.headers ?? {})
    }
  })
  const body = await response.json().catch(() => ({})) as unknown
  if (!response.ok) {
    throw new Error(`Relay request failed: ${init.method ?? 'GET'} ${path} ${response.status} ${cleanErrorBody(body)}`)
  }
  assertCondition(isRecord(body), `Relay request returned a non-object JSON body: ${path}`)
  return body as T
}

const requestText = async (
  relayUrl: string,
  path: string,
  init: RequestInit = {}
) => {
  const response = await fetch(`${relayUrl}${path}`, init)
  const body = await response.text()
  if (!response.ok) {
    throw new Error(`Relay request failed: ${init.method ?? 'GET'} ${path} ${response.status}`)
  }
  return body
}

const bearerHeaders = (token: string) => ({
  authorization: `Bearer ${token}`
})

const postJson = <T extends JsonRecord = JsonRecord>(
  relayUrl: string,
  path: string,
  token: string,
  body: JsonRecord
) =>
  requestJson<T>(relayUrl, path, {
    body: JSON.stringify(body),
    headers: bearerHeaders(token),
    method: 'POST'
  })

const patchJson = <T extends JsonRecord = JsonRecord>(
  relayUrl: string,
  path: string,
  token: string,
  body: JsonRecord
) =>
  requestJson<T>(relayUrl, path, {
    body: JSON.stringify(body),
    headers: bearerHeaders(token),
    method: 'PATCH'
  })

const requireRecordField = (value: JsonRecord, field: string): JsonRecord => {
  const fieldValue = value[field]
  assertCondition(isRecord(fieldValue), `Expected response.${field} to be an object.`)
  return fieldValue
}

const requireStringField = (value: JsonRecord, field: string): string => {
  const fieldValue = value[field]
  assertCondition(typeof fieldValue === 'string' && fieldValue !== '', `Expected response.${field} to be a string.`)
  return fieldValue
}

const requireArrayField = (value: JsonRecord, field: string): unknown[] => {
  const fieldValue = value[field]
  assertCondition(Array.isArray(fieldValue), `Expected response.${field} to be an array.`)
  return fieldValue
}

const loginPassword = async (relayUrl: string, email: string, password: string) => {
  const response = await requestJson(relayUrl, '/api/auth/password-login', {
    body: JSON.stringify({ email, password }),
    method: 'POST'
  })
  return requireStringField(response, 'token')
}

const setupRelayData = async (relayUrl: string, adminToken: string) => {
  const ownerEmail = 'relay-live-owner@example.com'
  const memberEmail = 'relay-live-member@example.com'
  const ownerPassword = 'relay-live-owner-password'
  const memberPassword = 'relay-live-member-password'

  await postJson(relayUrl, '/api/admin/users', adminToken, {
    email: ownerEmail,
    id: 'relay-live-owner',
    name: 'Relay Live Owner',
    password: ownerPassword,
    role: 'owner'
  })
  await postJson(relayUrl, '/api/admin/users', adminToken, {
    email: memberEmail,
    id: 'relay-live-member',
    name: 'Relay Live Member',
    password: memberPassword,
    role: 'member'
  })
  await patchJson(relayUrl, '/api/admin/team-policy', adminToken, {
    allowedSecretModes: ['device_encrypted', 'proxy'],
    maxAssignmentsPerProfile: 8,
    maxMembersPerTeam: 8,
    maxProfilesPerTeam: 4,
    maxTeamsPerTenant: 4,
    maxTeamsPerUser: 4,
    selfServiceTeamCreation: true,
    teamsEnabled: true
  })

  const ownerToken = await loginPassword(relayUrl, ownerEmail, ownerPassword)
  const memberToken = await loginPassword(relayUrl, memberEmail, memberPassword)
  const teamResponse = await postJson(relayUrl, '/api/admin/teams', adminToken, {
    name: 'Relay Live Smoke Team',
    ownerUserId: 'relay-live-owner',
    slug: 'relay-live-smoke'
  })
  const team = requireRecordField(teamResponse, 'team')
  const teamId = requireStringField(team, 'id')
  await postJson(relayUrl, `/api/admin/teams/${teamId}/members`, adminToken, {
    configEnabled: true,
    defaultForPublishing: false,
    role: 'member',
    userId: 'relay-live-member'
  })

  const usersResponse = await requestJson(relayUrl, '/api/admin/users', {
    headers: bearerHeaders(adminToken)
  })
  const users = requireArrayField(usersResponse, 'users')
  const member = users.find((item): item is JsonRecord => isRecord(item) && item.id === 'relay-live-member')
  assertCondition(member != null, 'Expected admin users response to include the team member.')
  const memberTeams = requireArrayField(member, 'teams')
  assertCondition(
    memberTeams.some(item => isRecord(item) && item.id === teamId && item.configEnabled === true),
    'Expected admin users response to expose member team configEnabled state.'
  )

  const secretResponse = await postJson(relayUrl, `/api/relay/teams/${teamId}/config-secrets`, ownerToken, {
    name: 'Relay Live API Key',
    value: LIVE_SECRET_VALUE
  })
  assertCondition(
    !JSON.stringify(secretResponse).includes(LIVE_SECRET_VALUE),
    'Config secret response must not echo plaintext secret values.'
  )
  const secretId = requireStringField(requireRecordField(secretResponse, 'secret'), 'id')
  const profileResponse = await postJson(relayUrl, `/api/relay/teams/${teamId}/config-profiles`, ownerToken, {
    name: 'Relay Live Profile'
  })
  const profileId = requireStringField(requireRecordField(profileResponse, 'profile'), 'id')
  const versionResponse = await postJson(relayUrl, `/api/relay/config-profiles/${profileId}/versions`, ownerToken, {
    allowedFields: ['modelServices', 'plugins', 'skills'],
    configPatch: {
      modelServices: {
        [LIVE_SERVICE_KEY]: {
          apiBaseUrl: 'https://relay-live.example.com/v1',
          apiKey: LIVE_SECRET_VALUE,
          models: [LIVE_MODEL],
          title: 'Relay Live Smoke'
        }
      },
      plugins: [
        {
          id: LIVE_PLUGIN_ID
        }
      ],
      skills: [LIVE_SKILL_ID]
    },
    secretRefs: {
      [LIVE_SECRET_REF]: secretId
    }
  })
  const versionId = requireStringField(requireRecordField(versionResponse, 'version'), 'id')
  await postJson(relayUrl, `/api/relay/config-profiles/${profileId}/publish`, ownerToken, { versionId })
  const assignmentResponse = await postJson(
    relayUrl,
    `/api/relay/config-profiles/${profileId}/assignments`,
    ownerToken,
    {
      enabled: true,
      priority: 10,
      project: {
        allow: [LIVE_PROJECT_ID]
      },
      target: {
        teamIds: [teamId]
      },
      versionId
    }
  )
  const assignmentId = requireStringField(requireRecordField(assignmentResponse, 'assignment'), 'id')

  return {
    assignmentId,
    memberToken,
    profileId,
    teamId
  }
}

const registerDeviceAndFetchSnapshot = async (
  relayUrl: string,
  memberToken: string,
  workspaceDir: string
) => {
  const deviceResponse = await postJson(relayUrl, '/api/relay/devices/register', memberToken, {
    capabilities: {
      configSnapshot: true
    },
    deviceId: LIVE_DEVICE_ID,
    deviceName: 'Relay Live Smoke Device',
    pluginScope: 'relay-live-smoke',
    workspaceFolder: workspaceDir
  })
  const deviceToken = requireStringField(deviceResponse, 'deviceToken')
  const snapshot = await requestJson(relayUrl, `/api/relay/config-snapshot?projectId=${LIVE_PROJECT_ID}`, {
    headers: bearerHeaders(deviceToken)
  })
  const sessionSnapshot = await requestJson(relayUrl, `/api/relay/config-snapshot?projectId=${LIVE_PROJECT_ID}`, {
    headers: bearerHeaders(memberToken)
  })
  assertCondition(!JSON.stringify(sessionSnapshot).includes('"secrets"'), 'Session snapshot must not include secrets.')
  return {
    deviceToken,
    snapshot
  }
}

const assertSnapshot = (snapshot: JsonRecord, assignmentId: string) => {
  assertCondition(
    !JSON.stringify(snapshot).includes(LIVE_SECRET_VALUE),
    'Device snapshot must not contain plaintext secret.'
  )
  const assignments = requireArrayField(snapshot, 'assignments')
  assertCondition(
    assignments.length === 1,
    `Expected exactly one matching config assignment, got ${assignments.length}.`
  )
  const assignment = assignments[0]
  assertCondition(isRecord(assignment), 'Expected config assignment to be an object.')
  assertCondition(assignment.id === assignmentId, 'Expected device snapshot to include the created assignment.')
  const configPatch = requireRecordField(assignment, 'configPatch')
  assertCondition(
    !JSON.stringify(configPatch).includes('apiKey'),
    'Config patch must not include secret-like apiKey fields.'
  )
  assertCondition(
    JSON.stringify(configPatch).includes(LIVE_SERVICE_KEY),
    'Config patch must include live model service.'
  )
  assertCondition(JSON.stringify(configPatch).includes(LIVE_PLUGIN_ID), 'Config patch must include plugin entries.')
  assertCondition(JSON.stringify(configPatch).includes(LIVE_SKILL_ID), 'Config patch must include skill entries.')
  const secrets = requireArrayField(assignment, 'secrets')
  assertCondition(secrets.length === 1, `Expected exactly one device encrypted secret envelope, got ${secrets.length}.`)
  const envelope = secrets[0]
  assertCondition(isRecord(envelope), 'Expected secret envelope to be an object.')
  assertCondition(envelope.algorithm === 'aes-256-gcm', 'Secret envelope must use aes-256-gcm.')
  assertCondition(
    envelope.keyId === `device:${LIVE_DEVICE_ID}:token`,
    'Secret envelope keyId must target the device token.'
  )
  assertCondition(envelope.ref === LIVE_SECRET_REF, 'Secret envelope must keep the original secret reference.')
}

const createSourceRelayPluginFixture = async (repoRoot: string, tempRoot: string) => {
  const pluginRoot = resolve(repoRoot, 'packages/plugins/relay')
  const fixtureRoot = join(tempRoot, 'relay-plugin-source')
  await writeJson(join(fixtureRoot, 'plugin.json'), {
    __oneWorksPluginManifest: true,
    configHook: {
      entry: resolve(pluginRoot, 'src/config.cts')
    }
  })
  return fixtureRoot
}

const createLiveWorkspace = async (input: {
  deviceToken: string
  relayUrl: string
  repoRoot: string
  snapshot: JsonRecord
  tempRoot: string
}) => {
  const workspaceDir = join(input.tempRoot, 'workspace')
  const projectHome = join(input.tempRoot, 'project-home')
  const realHome = join(input.tempRoot, 'real-home')
  const configRoot = resolve(input.repoRoot, 'packages/config')
  const pluginRoot = resolve(input.repoRoot, 'packages/plugins/relay')
  const sourcePluginRoot = await createSourceRelayPluginFixture(input.repoRoot, input.tempRoot)
  const configLink = join(workspaceDir, 'node_modules/@oneworks/config')
  const pluginLink = join(workspaceDir, 'node_modules/@oneworks/plugin-relay')

  await mkdir(dirname(pluginLink), { recursive: true })
  await mkdir(projectHome, { recursive: true })
  await mkdir(realHome, { recursive: true })
  await symlink(configRoot, configLink, 'dir')
  await symlink(pluginRoot, pluginLink, 'dir')
  await writeJson(join(workspaceDir, '.oo.config.json'), {
    disableGlobalConfig: true,
    plugins: [
      {
        id: sourcePluginRoot,
        options: {
          activeServerId: input.relayUrl,
          enableOfficialCloudflareRelay: false,
          enableOfficialVercelRelay: false,
          projectId: LIVE_PROJECT_ID,
          servers: [
            {
              baseUrl: input.relayUrl,
              id: input.relayUrl
            }
          ]
        }
      }
    ]
  })
  await writeJson(join(projectHome, '.local', 'plugins', 'relay', 'device.json'), {
    deviceId: LIVE_DEVICE_ID,
    deviceName: 'Relay Live Smoke Device',
    deviceSecret: 'relay-live-smoke-device-secret',
    servers: {
      [input.relayUrl]: {
        deviceToken: input.deviceToken,
        id: input.relayUrl,
        remoteBaseUrl: input.relayUrl
      }
    }
  })
  await writeJson(join(projectHome, ...snapshotRelativePath), input.snapshot)

  return {
    env: {
      ...process.env,
      __ONEWORKS_PROJECT_DISABLE_DEV_CONFIG__: '1',
      __ONEWORKS_PROJECT_DISABLE_DEFAULT_OFFICIAL_PLUGINS__: '1',
      __ONEWORKS_PROJECT_DISABLE_GLOBAL_CONFIG__: '1',
      __ONEWORKS_PROJECT_HOME_PROJECT_DIR__: projectHome,
      __ONEWORKS_PROJECT_HOME_PROJECTS_DIR__: join(input.tempRoot, 'project-homes'),
      __ONEWORKS_PROJECT_PLUGIN_AUTO_INSTALL__: 'false',
      __ONEWORKS_PROJECT_REAL_HOME__: realHome,
      __ONEWORKS_PROJECT_WORKSPACE_FOLDER__: workspaceDir
    },
    projectHome,
    workspaceDir
  }
}

const loadConfigApi = async (workspaceDir: string): Promise<ConfigApi> => {
  const workspaceRequire = createRequire(resolve(workspaceDir, '.oo.config.json'))
  return workspaceRequire(workspaceRequire.resolve('@oneworks/config')) as ConfigApi
}

const assertMergedConfig = async (input: {
  env: NodeJS.ProcessEnv
  workspaceDir: string
}) => {
  const configApi = await loadConfigApi(input.workspaceDir)
  configApi.resetConfigCache()
  const state = await configApi.loadConfigState({
    cwd: input.workspaceDir,
    env: input.env,
    jsonVariables: {}
  })
  configApi.resetConfigCache()
  const config = state.mergedConfig as ConfigState['mergedConfig']
  const service = config.modelServices?.[LIVE_SERVICE_KEY]

  assertCondition(service != null, 'Merged config must include the live Relay model service.')
  assertCondition(service.apiBaseUrl === 'https://relay-live.example.com/v1', 'Merged service apiBaseUrl mismatch.')
  assertCondition(service.apiKey === LIVE_SECRET_VALUE, 'Merged service apiKey must be decrypted locally.')
  assertCondition(service.models?.includes(LIVE_MODEL) === true, 'Merged service model list mismatch.')
  assertCondition(
    JSON.stringify(config.plugins).includes(LIVE_PLUGIN_ID),
    'Merged config must include team plugin entries.'
  )
  assertCondition(
    JSON.stringify(config.skills).includes(LIVE_SKILL_ID),
    'Merged config must include team skill entries.'
  )
}

const assertAdminAssets = async (relayUrl: string) => {
  const html = await requestText(relayUrl, '/admin')
  const js = await requestText(relayUrl, '/admin/assets/admin.js')
  const css = await requestText(relayUrl, '/admin/assets/admin.css')
  assertCondition(html.includes('/admin/assets/admin.js'), 'Embedded Admin shell must reference admin.js.')
  assertCondition(js.length > 1024, 'Embedded Admin admin.js asset is unexpectedly small.')
  assertCondition(css.length > 128, 'Embedded Admin admin.css asset is unexpectedly small.')
  return {
    adminShellOk: true,
    cssBytes: Buffer.byteLength(css),
    jsBytes: Buffer.byteLength(js)
  }
}

const createRelayArgs = (relayServerModule: RelayServerModule, tempRoot: string) =>
  relayServerModule.parseRelayServerArgs([
    '--host',
    '127.0.0.1',
    '--port',
    '0',
    '--data',
    join(tempRoot, 'relay.json'),
    '--admin-token',
    'relay-live-smoke-admin-token',
    '--storage-driver',
    'json'
  ], {
    ...process.env,
    ONEWORKS_RELAY_ALLOW_ORIGIN: '*',
    ONEWORKS_RELAY_DEVICE_METADATA_SECRET: 'relay-live-smoke-device-metadata-secret',
    ONEWORKS_RELAY_EMAIL_PROVIDER: 'disabled',
    ONEWORKS_RELAY_PASSKEY_ENABLED: '0',
    ONEWORKS_RELAY_STORAGE_DRIVER: 'json'
  })

const printResult = (result: RelayConfigLiveSmokeResult, json: boolean) => {
  if (json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
    return
  }
  process.stdout.write('[relay-config-live-smoke] ok\n')
  process.stdout.write(`[relay-config-live-smoke] relay=${result.relayUrl}\n`)
  process.stdout.write(`[relay-config-live-smoke] snapshot=${result.snapshotHash}\n`)
}

const muteProcessWarnings = () => {
  const previous = process.emitWarning
  process.emitWarning = ((warning: string | Error, ...args: unknown[]) => {
    const code = args.find(item => typeof item === 'string')
    const message = warning instanceof Error ? warning.message : String(warning)
    if (
      code === 'MODULE_TYPELESS_PACKAGE_JSON' ||
      message.includes('Module type of file') ||
      message.includes('MODULE_TYPELESS_PACKAGE_JSON')
    ) {
      return
    }
    const emit = previous as (...input: unknown[]) => void
    emit.call(process, warning, ...args)
  }) as typeof process.emitWarning
  return () => {
    process.emitWarning = previous
  }
}

export const runRelayConfigLiveSmoke = async (options: RelayConfigLiveSmokeOptions = {}) => {
  const repoRoot = resolve(options.repoRoot ?? process.cwd())
  const tempRoot = await mkdtemp(join(tmpdir(), 'oneworks-relay-config-live-smoke-'))
  let server: Server | undefined
  let configWorkspaceDir: string | undefined
  const previousRelayLogLevel = process.env.ONEWORKS_RELAY_LOG_LEVEL
  const restoreProcessWarnings = options.json === true ? muteProcessWarnings() : undefined

  try {
    if (options.json === true) {
      process.env.ONEWORKS_RELAY_LOG_LEVEL = 'warn'
    }
    await buildRelayServer(repoRoot, options.json === true)
    if (options.skipAdminBuild !== true) {
      await buildRelayAdmin(repoRoot, options.json === true)
    }

    const relayServerModule = loadRelayServerModule(repoRoot)
    const args = createRelayArgs(relayServerModule, tempRoot)
    server = relayServerModule.createRelayServer(args)
    const relayUrl = await listenServer(server, args.host, args.port)
    args.publicBaseUrl = relayUrl
    args.port = Number(new URL(relayUrl).port)

    const adminToken = args.adminToken
    const { assignmentId, memberToken, profileId, teamId } = await setupRelayData(relayUrl, adminToken)
    const pendingWorkspaceDir = join(tempRoot, 'workspace')
    const { deviceToken, snapshot } = await registerDeviceAndFetchSnapshot(relayUrl, memberToken, pendingWorkspaceDir)
    assertSnapshot(snapshot, assignmentId)

    const workspace = await createLiveWorkspace({
      deviceToken,
      relayUrl,
      repoRoot,
      snapshot,
      tempRoot
    })
    configWorkspaceDir = workspace.workspaceDir
    await assertMergedConfig({
      env: workspace.env,
      workspaceDir: workspace.workspaceDir
    })

    const adminAssets = await assertAdminAssets(relayUrl)
    const snapshotHash = requireStringField(snapshot, 'hash')
    const result: RelayConfigLiveSmokeResult = {
      adminAssetBytes: {
        css: adminAssets.cssBytes,
        js: adminAssets.jsBytes
      },
      adminShellOk: adminAssets.adminShellOk,
      assignmentId,
      checks: {
        adminAssets: true,
        adminUserTeamSummary: true,
        configHookMerged: true,
        deviceSnapshot: true,
        secretEnvelopeOnly: true,
        teamPolicy: true
      },
      ok: true,
      profileId,
      projectHome: workspace.projectHome,
      relayUrl,
      snapshotHash: snapshotHash || `sha256:${createHash('sha256').update(JSON.stringify(snapshot)).digest('hex')}`,
      teamId,
      tempRoot,
      workspaceDir: workspace.workspaceDir
    }
    printResult(result, options.json === true)
    return result
  } finally {
    if (configWorkspaceDir != null) {
      try {
        const configApi = await loadConfigApi(configWorkspaceDir)
        configApi.resetConfigCache()
      } catch {}
    }
    if (server != null) {
      await closeServer(server).catch(() => {})
    }
    if (previousRelayLogLevel == null) {
      delete process.env.ONEWORKS_RELAY_LOG_LEVEL
    } else {
      process.env.ONEWORKS_RELAY_LOG_LEVEL = previousRelayLogLevel
    }
    restoreProcessWarnings?.()
    if (options.keepTemp !== true) {
      await rm(tempRoot, { force: true, recursive: true })
    }
  }
}
