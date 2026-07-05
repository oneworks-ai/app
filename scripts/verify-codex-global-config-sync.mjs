#!/usr/bin/env node
/* eslint-disable max-lines -- end-to-end Docker smoke keeps orchestration steps in one executable entrypoint. */
import { Buffer } from 'node:buffer'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, readdir, rename, writeFile } from 'node:fs/promises'
import { basename, dirname, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const dockerfile = resolve(repoRoot, 'scripts/docker/codex-global-config-sync.Dockerfile')
const imageTag = process.env.ONEWORKS_RELAY_DOCKER_IMAGE ?? 'oneworks-codex-global-config-sync-packaged:dev'
const containerName = process.env.ONEWORKS_RELAY_DOCKER_CONTAINER ?? 'oneworks-relay-linux-daemon-package-smoke'
const hostManagerUrl = process.env.ONEWORKS_RELAY_SMOKE_MANAGER_URL ?? await readManagerUrl()
const hostRelayUrl = normalizeUrl(process.env.ONEWORKS_RELAY_SMOKE_RELAY_URL ?? 'http://127.0.0.1:48890')
const containerRelayUrl = toContainerHostUrl(hostRelayUrl)
const containerPort = Number(process.env.ONEWORKS_RELAY_DOCKER_PORT ?? '8832')
const hostDaemonUrl = `http://127.0.0.1:${containerPort}`
const workspaceFolder = process.env.ONEWORKS_RELAY_DOCKER_WORKSPACE ?? '/workspaces/linux-remote-a'
const createWorkspaceParent = process.env.ONEWORKS_RELAY_DOCKER_CREATE_PARENT ?? '/workspaces'
const createWorkspaceName = process.env.ONEWORKS_RELAY_DOCKER_CREATE_NAME ?? `linux-created-${Date.now().toString(36)}`
const verifyAgent = process.env.ONEWORKS_RELAY_DOCKER_VERIFY_AGENT === '1'
const agentModel = process.env.ONEWORKS_RELAY_DOCKER_AGENT_MODEL ?? 'gpt-5.5'
const dockerDaemonReadyTimeoutMs = Number(process.env.ONEWORKS_RELAY_DOCKER_READY_TIMEOUT_MS ?? '600000')
const remoteWorkspaceRequestTimeoutMs = Number(process.env.ONEWORKS_RELAY_DOCKER_WORKSPACE_TIMEOUT_MS ?? '120000')
const agentReplyTimeoutMs = Number(process.env.ONEWORKS_RELAY_DOCKER_AGENT_TIMEOUT_MS ?? '600000')
const codexCliVersion = process.env.ONEWORKS_RELAY_DOCKER_CODEX_CLI_VERSION ?? await readCodexCliDefaultVersion()
const codexCliInstallTimeoutSeconds = Number(process.env.ONEWORKS_RELAY_DOCKER_CODEX_INSTALL_TIMEOUT_SECONDS ?? '600')
const codexSmokeAccountKey = process.env.ONEWORKS_RELAY_DOCKER_CODEX_ACCOUNT ?? 'docker-smoke'
const packageSeedNames = [
  'oneworks',
  '@oneworks/cli',
  '@oneworks/server',
  '@oneworks/plugin-relay',
  '@oneworks/adapter-codex'
]
const workspacePackageRootDirs = ['apps', 'packages']
const dependencySections = ['dependencies', 'optionalDependencies', 'peerDependencies']
const ignoredPackageSearchDirs = new Set([
  '.git',
  '.logs',
  '.next',
  '.turbo',
  '.vitepress',
  'coverage',
  'dist',
  'node_modules'
])

const run = (command, args, options = {}) =>
  new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, {
      cwd: repoRoot,
      stdio: options.capture === true ? ['ignore', 'pipe', 'pipe'] : 'inherit',
      ...options
    })
    let stdout = ''
    let stderr = ''
    if (child.stdout != null) {
      child.stdout.on('data', chunk => {
        stdout += String(chunk)
      })
    }
    if (child.stderr != null) {
      child.stderr.on('data', chunk => {
        stderr += String(chunk)
      })
    }

    child.once('error', rejectPromise)
    child.once('exit', (code) => {
      if (code === 0) {
        resolvePromise({ stdout, stderr })
        return
      }
      rejectPromise(new Error(`${command} ${args.join(' ')} exited with code ${code ?? 'unknown'}\n${stderr}`))
    })
  })

async function collectPackageJsonPaths(dir, output = []) {
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return output
  }

  for (const entry of entries) {
    if (entry.name === 'package.json' && entry.isFile()) {
      output.push(resolve(dir, entry.name))
      continue
    }
    if (!entry.isDirectory() || ignoredPackageSearchDirs.has(entry.name)) {
      continue
    }
    await collectPackageJsonPaths(resolve(dir, entry.name), output)
  }
  return output
}

async function readWorkspacePackageIndex() {
  const packageJsonPaths = []
  for (const rootDir of workspacePackageRootDirs) {
    await collectPackageJsonPaths(resolve(repoRoot, rootDir), packageJsonPaths)
  }

  const packages = new Map()
  for (const packageJsonPath of packageJsonPaths) {
    const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf8'))
    if (typeof packageJson.name !== 'string' || packageJson.name.trim() === '') {
      continue
    }
    packages.set(packageJson.name, {
      dir: dirname(packageJsonPath),
      packageJson,
      packageJsonPath
    })
  }
  return packages
}

const readInternalDependencyNames = (packageJson, packageIndex) => {
  const names = new Set()
  for (const section of dependencySections) {
    const dependencies = packageJson[section]
    if (dependencies == null || typeof dependencies !== 'object' || Array.isArray(dependencies)) {
      continue
    }
    for (const name of Object.keys(dependencies)) {
      if (packageIndex.has(name)) {
        names.add(name)
      }
    }
  }
  return names
}

function collectPackageClosure(packageIndex) {
  const packageNames = new Set()
  const queue = [...packageSeedNames]
  for (let index = 0; index < queue.length; index += 1) {
    const packageName = queue[index]
    if (packageNames.has(packageName)) {
      continue
    }
    const packageInfo = packageIndex.get(packageName)
    if (packageInfo == null) {
      throw new Error(`Workspace package not found for Docker smoke seed: ${packageName}`)
    }
    packageNames.add(packageName)
    for (const dependencyName of readInternalDependencyNames(packageInfo.packageJson, packageIndex)) {
      queue.push(dependencyName)
    }
  }
  return [...packageNames].sort((left, right) => left.localeCompare(right))
}

const parsePackOutput = stdout => {
  const trimmed = stdout.trim()
  if (trimmed === '') {
    throw new Error('pnpm pack did not return JSON output.')
  }
  const parsed = JSON.parse(trimmed)
  const packInfo = Array.isArray(parsed) ? parsed.at(-1) : parsed
  if (typeof packInfo?.filename !== 'string' || packInfo.filename.trim() === '') {
    throw new Error(`pnpm pack returned an unexpected payload: ${trimmed}`)
  }
  return packInfo.filename
}

async function createPackagedInstallSeed(tempDir) {
  const packageIndex = await readWorkspacePackageIndex()
  const packageNames = collectPackageClosure(packageIndex)
  const tarballDir = resolve(tempDir, 'tarballs')
  await mkdir(tarballDir, { recursive: true })

  await run('pnpm', ['--filter', '@oneworks/plugin-relay', 'build'])

  const tarballs = {}
  for (const packageName of packageNames) {
    const packageInfo = packageIndex.get(packageName)
    const { stdout } = await run('pnpm', [
      '--dir',
      packageInfo.dir,
      'pack',
      '--pack-destination',
      tarballDir,
      '--json'
    ], { capture: true })
    const filename = parsePackOutput(stdout)
    tarballs[packageName] = `file:/seed/tarballs/${basename(filename)}`
  }

  const dependencies = Object.fromEntries(packageNames.map(packageName => [packageName, tarballs[packageName]]))
  const packageJson = {
    private: true,
    name: 'oneworks-linux-daemon-package-smoke',
    version: '0.0.0',
    dependencies
  }
  await writeFile(resolve(tempDir, 'package.json'), `${JSON.stringify(packageJson, null, 2)}\n`)
  await writeFile(
    resolve(tempDir, 'pnpm-workspace.yaml'),
    [
      'packages: []',
      'onlyBuiltDependencies:',
      "  - '@oneworks/cli'",
      '  - esbuild',
      '  - node-pty',
      '  - protobufjs',
      'overrides:',
      ...packageNames.map(packageName => `  '${packageName}': '${tarballs[packageName]}'`),
      ''
    ].join('\n')
  )
  return {
    packageNames,
    tarballs
  }
}

async function readCodexCliDefaultVersion() {
  const pathsSource = await readFile(resolve(repoRoot, 'packages/adapters/codex/src/paths.ts'), 'utf8')
  const match = pathsSource.match(/CODEX_CLI_VERSION\s*=\s*['"]([^'"]+)['"]/u)
  if (match == null) {
    throw new Error('Unable to read Codex CLI default version from packages/adapters/codex/src/paths.ts')
  }
  return match[1]
}

async function readManagerUrl() {
  const statePath = resolve(repoRoot, '.logs/dev-start-web.json')
  if (!existsSync(statePath)) return 'http://127.0.0.1:8814'
  try {
    const parsed = JSON.parse(await readFile(statePath, 'utf8'))
    return normalizeUrl(typeof parsed.serverUrl === 'string' ? parsed.serverUrl : 'http://127.0.0.1:8814')
  } catch {
    return 'http://127.0.0.1:8814'
  }
}

function normalizeUrl(value) {
  const url = new URL(value)
  return url.origin
}

function toContainerHostUrl(value) {
  const url = new URL(value)
  if (url.hostname === '127.0.0.1' || url.hostname === 'localhost' || url.hostname === '::1') {
    url.hostname = 'host.docker.internal'
  }
  return url.origin
}

function toContainerReachableAuth(value) {
  if (Array.isArray(value)) {
    return value.map(item => toContainerReachableAuth(item))
  }
  if (value != null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, nestedValue]) => [key, toContainerReachableAuth(nestedValue)])
    )
  }
  if (typeof value !== 'string') return value
  return value
    .replaceAll(hostRelayUrl, containerRelayUrl)
    .replaceAll(hostRelayUrl.replace('127.0.0.1', 'localhost'), containerRelayUrl)
    .replaceAll(hostRelayUrl.replace('127.0.0.1', '[::1]'), containerRelayUrl)
}

async function fetchJson(url, options = {}) {
  const timeoutMs = Number.isFinite(options.timeoutMs) && options.timeoutMs > 0 ? options.timeoutMs : 15_000
  const controller = new AbortController()
  const timeout = setTimeout(() => {
    controller.abort(new Error(`Timed out after ${timeoutMs}ms`))
  }, timeoutMs)
  const { timeoutMs: _timeoutMs, ...fetchOptions } = options
  let response
  try {
    response = await fetch(url, {
      ...fetchOptions,
      signal: controller.signal,
      headers: {
        ...(fetchOptions.body == null ? {} : { 'content-type': 'application/json' }),
        ...fetchOptions.headers
      }
    })
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(`${fetchOptions.method ?? 'GET'} ${url} timed out after ${timeoutMs}ms`)
    }
    throw error
  } finally {
    clearTimeout(timeout)
  }
  const text = await response.text()
  let body
  try {
    body = text === '' ? undefined : JSON.parse(text)
  } catch {
    body = text
  }
  if (!response.ok) {
    throw new Error(`${fetchOptions.method ?? 'GET'} ${url} failed with ${response.status}: ${text}`)
  }
  return body
}

async function waitForJson(url, input = {}) {
  const startedAt = Date.now()
  const timeoutMs = input.timeoutMs ?? 120_000
  let lastError
  while (Date.now() - startedAt < timeoutMs) {
    try {
      return await fetchJson(url, input.fetchOptions)
    } catch (error) {
      lastError = error
      await new Promise(resolvePromise => setTimeout(resolvePromise, input.intervalMs ?? 1_000))
    }
  }
  throw lastError instanceof Error ? lastError : new Error(`Timed out waiting for ${url}`)
}

async function readJsonFile(path, fallback) {
  if (!existsSync(path)) return fallback
  const text = await readFile(path, 'utf8')
  return text.trim() === '' ? fallback : JSON.parse(text)
}

async function writeJsonFile(path, value) {
  await mkdir(dirname(path), { recursive: true })
  const tempPath = `${path}.${process.pid}.${Date.now()}.tmp`
  await writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`)
  await rename(tempPath, path)
}

const isRecord = value => value != null && typeof value === 'object' && !Array.isArray(value)

const cleanText = value => {
  const text = typeof value === 'string' ? value.trim() : ''
  return text === '' ? undefined : text
}

const hasCodexInlineAuth = account => (
  isRecord(account) &&
  isRecord(account.auth) &&
  (cleanText(account.auth.type) == null || cleanText(account.auth.type) === 'codex-auth-json') &&
  cleanText(account.auth.encoding) === 'base64' &&
  cleanText(account.auth.token) != null
)

const collectCodexAuthAccounts = codexConfig => {
  const accounts = isRecord(codexConfig?.accounts) ? codexConfig.accounts : {}
  return Object.entries(accounts)
    .filter((entry) => hasCodexInlineAuth(entry[1]))
    .map(([key, account]) => ({
      key,
      tokenLength: cleanText(account.auth.token)?.length ?? 0
    }))
}

async function ensureHostCodexGlobalConfigPatch() {
  const globalConfigPath = resolve(process.env.HOME ?? '', '.oneworks/.oo.config.json')
  const realCodexAuthPath = resolve(process.env.HOME ?? '', '.codex/auth.json')
  const config = await readJsonFile(globalConfigPath, {})
  const adapters = isRecord(config.adapters) ? { ...config.adapters } : {}
  const codex = isRecord(adapters.codex) ? { ...adapters.codex } : {}
  const accounts = isRecord(codex.accounts) ? { ...codex.accounts } : {}
  let authAccounts = collectCodexAuthAccounts({ ...codex, accounts })
  let wroteGlobalConfig = false

  if (authAccounts.length === 0) {
    if (!existsSync(realCodexAuthPath)) {
      throw new Error(
        `Missing Codex auth source. Expected either ${globalConfigPath} adapters.codex.accounts auth or ${realCodexAuthPath}.`
      )
    }
    const authContent = await readFile(realCodexAuthPath, 'utf8')
    const now = Date.now()
    const existingSmokeAccount = isRecord(accounts[codexSmokeAccountKey])
      ? accounts[codexSmokeAccountKey]
      : {}
    const { title: _existingSmokeTitle, ...existingSmokeAccountWithoutTitle } = existingSmokeAccount
    accounts[codexSmokeAccountKey] = {
      ...existingSmokeAccountWithoutTitle,
      description: 'Synced from host Codex auth.json for Linux Docker relay smoke verification.',
      source: 'docker-smoke-real-home',
      createdAt:
        isRecord(accounts[codexSmokeAccountKey]) && typeof accounts[codexSmokeAccountKey].createdAt === 'number'
          ? accounts[codexSmokeAccountKey].createdAt
          : now,
      updatedAt: now,
      authDigest: createHash('sha256').update(authContent).digest('hex'),
      auth: {
        type: 'codex-auth-json',
        encoding: 'base64',
        token: Buffer.from(authContent, 'utf8').toString('base64')
      }
    }
    codex.defaultAccount = codexSmokeAccountKey
    codex.accounts = accounts
    adapters.codex = codex
    config.adapters = adapters
    await writeJsonFile(globalConfigPath, config)
    wroteGlobalConfig = true
    authAccounts = collectCodexAuthAccounts(codex)
  }

  const defaultAccount = cleanText(codex.defaultAccount)
  if (defaultAccount == null || !hasCodexInlineAuth(accounts[defaultAccount])) {
    codex.defaultAccount = authAccounts[0]?.key ?? codexSmokeAccountKey
    codex.accounts = accounts
    adapters.codex = codex
    config.adapters = adapters
    await writeJsonFile(globalConfigPath, config)
    wroteGlobalConfig = true
  }

  const configPatch = {
    adapters: {
      codex: {
        defaultAccount: codex.defaultAccount,
        accounts
      }
    }
  }

  return {
    accountKeys: Object.keys(accounts),
    authAccountKeys: authAccounts.map(account => account.key),
    defaultAccount: cleanText(codex.defaultAccount),
    globalConfigPath,
    configPatch,
    wroteGlobalConfig
  }
}

function normalizeComparableUrl(value) {
  const text = cleanText(value)
  if (text == null) return undefined
  try {
    return new URL(text).origin.replace(/\/+$/u, '').toLowerCase()
  } catch {
    return text.replace(/\/+$/u, '').toLowerCase()
  }
}

const createAccountKey = (serverId, userId) => `${serverId}:${userId}`

const slugify = value => {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
  return slug === '' ? 'relay' : slug
}

const relayServerIdFromUrl = value => {
  const url = new URL(value)
  return slugify(`${url.protocol.replace(':', '')}-${url.host}${url.pathname}`)
}

async function readExistingRelayPublishAccount() {
  const authPath = resolve(process.env.HOME ?? '', '.oneworks/auth.json')
  const auth = await readJsonFile(authPath, {})
  const accounts = Array.isArray(auth.accounts) ? auth.accounts.filter(isRecord) : []
  const relayUrl = normalizeComparableUrl(hostRelayUrl)
  const account = accounts.find(item =>
    cleanText(item.sessionToken) != null &&
    normalizeComparableUrl(item.serverUrl) === relayUrl &&
    item.enabled !== false
  )
  if (account == null || cleanText(account.sessionToken) == null || cleanText(account.userId) == null) {
    return undefined
  }
  return {
    accountKey: cleanText(account.accountKey) ?? 'relay',
    email: cleanText(account.email),
    loginId: cleanText(account.loginId),
    name: cleanText(account.name),
    role: cleanText(account.role),
    serverId: cleanText(account.serverId) ?? 'local',
    serverName: 'Local',
    serverUrl: hostRelayUrl,
    sessionExpiresAt: cleanText(account.sessionExpiresAt),
    sessionToken: cleanText(account.sessionToken),
    userId: cleanText(account.userId)
  }
}

async function createRelayPublishAccount() {
  const inviteCode = `docker-smoke-${Date.now().toString(36)}`
  const email = `docker-smoke-${Date.now().toString(36)}@local.test`
  await fetchJson(`${hostRelayUrl}/api/admin/invites`, {
    method: 'POST',
    body: JSON.stringify({
      code: inviteCode,
      maxUses: 2,
      role: 'owner'
    })
  })
  const login = await fetchJson(`${hostRelayUrl}/api/auth/invite-login`, {
    method: 'POST',
    body: JSON.stringify({
      email,
      inviteCode,
      name: 'Docker Smoke Owner'
    })
  })
  const sessionToken = cleanText(login?.token)
  const user = isRecord(login?.user) ? login.user : {}
  const userId = cleanText(user.id)
  if (sessionToken == null || userId == null) {
    throw new Error(`Relay invite login did not return a usable session: ${JSON.stringify(login)}`)
  }
  const me = await fetchJson(`${hostRelayUrl}/api/auth/me`, {
    headers: {
      authorization: `Bearer ${sessionToken}`
    }
  }).catch(() => undefined)
  const session = isRecord(me?.session) ? me.session : {}
  return {
    accountKey: createAccountKey('local', userId),
    email: cleanText(user.email) ?? email,
    loginId: cleanText(user.loginId),
    name: cleanText(user.name) ?? 'Docker Smoke Owner',
    role: cleanText(user.role) ?? 'owner',
    serverId: 'local',
    serverName: 'Local',
    serverUrl: hostRelayUrl,
    sessionExpiresAt: cleanText(session.expiresAt),
    sessionToken,
    userId
  }
}

async function ensureRelayPublishAccount() {
  await waitForJson(`${hostRelayUrl}/health`, { timeoutMs: 30_000 })
  const existing = await readExistingRelayPublishAccount()
  if (existing != null) {
    try {
      await fetchJson(`${hostRelayUrl}/api/auth/me`, {
        headers: {
          authorization: `Bearer ${existing.sessionToken}`
        }
      })
      return existing
    } catch {
      // Fall through and create a real invite-login session for this smoke relay.
    }
  }
  return await createRelayPublishAccount()
}

async function ensureHostManagerRelayAccount(relayAccount) {
  const authPath = resolve(process.env.HOME ?? '', '.oneworks/auth.json')
  const auth = await readJsonFile(authPath, {})
  const accounts = Array.isArray(auth.accounts) ? auth.accounts.filter(isRecord) : []
  const servers = isRecord(auth.servers) ? { ...auth.servers } : {}
  const serverId = relayServerIdFromUrl(hostRelayUrl)
  const accountKey = createAccountKey(serverId, relayAccount.userId)
  const updatedAt = new Date().toISOString()
  const nextAccount = {
    accountKey,
    enabled: true,
    ...(relayAccount.email == null ? {} : { email: relayAccount.email }),
    ...(relayAccount.loginId == null ? {} : { loginId: relayAccount.loginId }),
    ...(relayAccount.name == null ? {} : { name: relayAccount.name }),
    ...(relayAccount.role == null ? {} : { role: relayAccount.role }),
    serverId,
    serverUrl: hostRelayUrl,
    ...(relayAccount.sessionExpiresAt == null ? {} : { sessionExpiresAt: relayAccount.sessionExpiresAt }),
    sessionToken: relayAccount.sessionToken,
    updatedAt,
    userId: relayAccount.userId
  }
  const nextStore = {
    accounts: [
      ...accounts.filter(account => account.accountKey !== accountKey),
      nextAccount
    ].sort((left, right) => String(left.accountKey).localeCompare(String(right.accountKey))),
    servers: {
      ...servers,
      [serverId]: {
        id: serverId,
        name: 'Docker Smoke Relay',
        url: hostRelayUrl
      }
    },
    version: 1
  }
  await writeJsonFile(authPath, nextStore)
  return nextAccount
}

async function ensureHostManagerRelayConnection(hostAccount) {
  const status = await fetchJson(`${hostManagerUrl}/api/plugins/relay/proxy/relay/connect`, {
    method: 'POST',
    body: JSON.stringify({
      accountKey: hostAccount.accountKey,
      serverId: hostRelayUrl
    })
  })
  const state = cleanText(status?.connection?.state)
  if (state !== 'registered') {
    throw new Error(`Host manager did not connect to smoke relay: ${JSON.stringify(status?.connection ?? status)}`)
  }
  return {
    accountKey: hostAccount.accountKey,
    serverId: hostAccount.serverId,
    state
  }
}

async function relayJson(path, sessionToken, options = {}) {
  return await fetchJson(`${hostRelayUrl}${path}`, {
    ...options,
    headers: {
      authorization: `Bearer ${sessionToken}`,
      ...(options.body == null ? {} : { 'content-type': 'application/json' }),
      ...options.headers
    }
  })
}

async function relayPutJson(path, sessionToken, body) {
  return await relayJson(path, sessionToken, {
    method: 'PUT',
    body: JSON.stringify(body)
  })
}

async function ensureRelayPersonalConfigPublished(configPatch, account) {
  const current = await relayJson('/api/relay/config/global', account.sessionToken).catch(() => ({}))
  const currentSnapshot = isRecord(current?.personalConfigSnapshot) ? current.personalConfigSnapshot : undefined
  const updated = await relayPutJson('/api/relay/config/global', account.sessionToken, {
    allowedFields: ['adapters'],
    ...(cleanText(currentSnapshot?.hash) == null ? {} : { baseHash: cleanText(currentSnapshot.hash) }),
    configPatch
  })
  const snapshot = isRecord(updated?.personalConfigSnapshot) ? updated.personalConfigSnapshot : undefined
  const hash = cleanText(snapshot?.hash)
  if (hash == null) {
    throw new Error(`Relay did not return a personal global config snapshot: ${JSON.stringify(updated)}`)
  }
  return {
    accountKey: account.accountKey,
    endpoint: '/api/relay/config/global',
    hash,
    updatedAt: cleanText(snapshot?.updatedAt),
    userId: account.userId
  }
}

async function readDockerRelayDeviceStore() {
  const script = [
    'const fs = require("node:fs");',
    'const path = require("node:path");',
    'const roots = ["/tmp/oneworks-linux-daemon/home/.oneworks/projects"];',
    'const matches = [];',
    'function visit(dir, depth) {',
    '  if (depth > 10) return;',
    '  let entries;',
    '  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }',
    '  for (const entry of entries) {',
    '    const next = path.join(dir, entry.name);',
    '    if (entry.isFile() && entry.name === "device.json" && dir.endsWith(path.join(".local", "plugins", "relay"))) {',
    '      matches.push(next);',
    '      continue;',
    '    }',
    '    if (entry.isDirectory()) visit(next, depth + 1);',
    '  }',
    '}',
    'for (const root of roots) visit(root, 0);',
    'const stores = matches.map(file => {',
    '  try { return { file, data: JSON.parse(fs.readFileSync(file, "utf8")) }; } catch { return undefined; }',
    '}).filter(Boolean);',
    'const selected = stores.find(store => Object.values(store.data?.servers || {}).some(server => server?.remoteBaseUrl === process.env.CONTAINER_RELAY_URL || server?.remoteBaseUrl === process.env.HOST_RELAY_URL)) ?? stores.at(0);',
    'if (selected == null) {',
    '  console.log(JSON.stringify({ found: false, stores: matches }));',
    '  process.exit(0);',
    '}',
    'const servers = selected.data?.servers && typeof selected.data.servers === "object" ? selected.data.servers : {};',
    'console.log(JSON.stringify({',
    '  found: true,',
    '  deviceId: selected.data?.deviceId,',
    '  deviceName: selected.data?.deviceName,',
    '  hasDeviceToken: Object.values(servers).some(server => typeof server?.deviceToken === "string" && server.deviceToken.length > 0),',
    '  serverCount: Object.keys(servers).length,',
    '  storePath: selected.file',
    '}));'
  ].join('')
  const { stdout } = await run('docker', [
    'exec',
    containerName,
    'env',
    `CONTAINER_RELAY_URL=${containerRelayUrl}`,
    `HOST_RELAY_URL=${hostRelayUrl}`,
    'node',
    '-e',
    script
  ], { capture: true })
  return JSON.parse(stdout.trim())
}

async function waitForDockerRelayDeviceStore() {
  const startedAt = Date.now()
  let lastSummary
  let lastError
  while (Date.now() - startedAt < 120_000) {
    try {
      lastSummary = await readDockerRelayDeviceStore()
      if (
        lastSummary?.found === true &&
        cleanText(lastSummary.deviceId) != null &&
        lastSummary.hasDeviceToken === true
      ) {
        return {
          deviceId: cleanText(lastSummary.deviceId),
          deviceName: cleanText(lastSummary.deviceName) ?? 'Linux Docker Smoke',
          hasDeviceToken: true,
          storePath: cleanText(lastSummary.storePath)
        }
      }
    } catch (error) {
      lastError = error
    }
    await new Promise(resolvePromise => setTimeout(resolvePromise, 1_000))
  }
  throw new Error(
    `Timed out waiting for Docker relay device store: ${
      JSON.stringify({
        lastError: lastError instanceof Error ? lastError.message : String(lastError),
        lastSummary
      })
    }`
  )
}

async function waitForRelayDevice(relayAccount, expectedDeviceId) {
  const startedAt = Date.now()
  let lastBody
  while (Date.now() - startedAt < 120_000) {
    lastBody = await relayJson('/api/relay/devices', relayAccount.sessionToken).catch(error => ({ error }))
    const devices = Array.isArray(lastBody?.devices) ? lastBody.devices : []
    const match = devices.find(device =>
      device != null &&
      device.id === expectedDeviceId &&
      device.status === 'online' &&
      device.capabilities?.workspaceLauncher === true &&
      device.capabilities?.sessions === true
    )
    if (match != null) {
      return {
        deviceId: match.id,
        deviceName: match.alias ?? match.name ?? 'Linux Docker Smoke',
        serverId: hostRelayUrl,
        serverName: 'Docker Smoke Relay'
      }
    }
    await new Promise(resolvePromise => setTimeout(resolvePromise, 1_500))
  }
  throw new Error(
    `Timed out waiting for Docker device ${expectedDeviceId} in relay server: ${JSON.stringify(lastBody)}`
  )
}

async function prepareDockerFiles(tempDir, relayAccount) {
  const now = new Date().toISOString()
  const containerAccount = {
    ...relayAccount,
    accountKey: createAccountKey('local', relayAccount.userId),
    serverId: 'local',
    serverName: 'Local',
    serverUrl: hostRelayUrl
  }
  const auth = toContainerReachableAuth({
    accounts: [
      {
        accountKey: containerAccount.accountKey,
        enabled: true,
        ...(containerAccount.email == null ? {} : { email: containerAccount.email }),
        ...(containerAccount.loginId == null ? {} : { loginId: containerAccount.loginId }),
        ...(containerAccount.name == null ? {} : { name: containerAccount.name }),
        ...(containerAccount.role == null ? {} : { role: containerAccount.role }),
        serverId: containerAccount.serverId,
        serverUrl: containerAccount.serverUrl,
        ...(containerAccount.sessionExpiresAt == null ? {} : { sessionExpiresAt: containerAccount.sessionExpiresAt }),
        sessionToken: containerAccount.sessionToken,
        updatedAt: now,
        userId: containerAccount.userId
      }
    ],
    servers: {
      [containerAccount.serverId]: {
        id: containerAccount.serverId,
        name: containerAccount.serverName,
        url: containerAccount.serverUrl
      }
    },
    version: 1
  })
  await writeFile(resolve(tempDir, 'relay-auth.json'), `${JSON.stringify(auth, null, 2)}\n`)
  await createPackagedInstallSeed(tempDir)

  await writeFile(
    resolve(tempDir, 'entrypoint.sh'),
    `#!/usr/bin/env bash
set -euo pipefail

mkdir -p /opt/oneworks-daemon /tmp/oneworks-linux-daemon/config /tmp/oneworks-linux-daemon/home/.oneworks /workspaces/linux-remote-a /workspaces/linux-remote-b
cp /seed/relay-auth.json /tmp/oneworks-linux-daemon/home/.oneworks/auth.json
cat > /tmp/oneworks-linux-daemon/config/.oo.config.json <<'JSON'
{
  "plugins": [
    {
      "id": "@oneworks/plugin-relay",
      "scope": "relay",
      "enabled": true,
      "options": {
        "deviceName": "Linux Docker Smoke",
        "autoConnect": true,
        "exposeWorkspaceLauncher": true,
        "configDistribution": {
          "enabled": true,
          "includeGlobalConfig": true
        },
        "servers": [
          {
            "id": "local",
            "name": "Local",
            "protocol": "http",
            "server": "host.docker.internal",
            "port": ${new URL(containerRelayUrl).port}
          }
        ],
        "activeServerId": "local"
      }
    }
  ]
}
JSON

printf '# Linux remote A\\n' > /workspaces/linux-remote-a/README.md
printf '# Linux remote B\\n' > /workspaces/linux-remote-b/README.md

if [ ! -f /opt/oneworks-daemon/.oneworks-smoke-installed ]; then
  cp /seed/package.json /opt/oneworks-daemon/package.json
  cp /seed/pnpm-workspace.yaml /opt/oneworks-daemon/pnpm-workspace.yaml
  cd /opt/oneworks-daemon
  export npm_config_nodedir=/usr/local
  pnpm config set store-dir /pnpm/store
  printf 'nodedir=/usr/local\\n' > /opt/oneworks-daemon/.npmrc
  pnpm install --prod --no-frozen-lockfile --config.nodedir=/usr/local
  find /opt/oneworks-daemon/node_modules/.pnpm -maxdepth 5 -path '*/node_modules/node-pty' -type d -print -quit | while read -r node_pty_dir; do
    (cd "$node_pty_dir" && npm rebuild --build-from-source --nodedir=/usr/local)
  done
  touch /opt/oneworks-daemon/.oneworks-smoke-installed
fi

${
      verifyAgent
        ? `if [ ! -f /opt/oneworks-codex-cli/.oneworks-codex-installed ]; then
  mkdir -p /opt/oneworks-codex-cli
  npm install --prefix /opt/oneworks-codex-cli --no-save --no-audit --no-fund @openai/codex@${codexCliVersion} &
  codex_install_pid=$!
  codex_install_deadline=$(( $(date +%s) + ${codexCliInstallTimeoutSeconds} ))
  codex_ready=0
  while [ "$(date +%s)" -lt "$codex_install_deadline" ]; do
    if [ -x /opt/oneworks-codex-cli/node_modules/@openai/codex/bin/codex.js ] && /opt/oneworks-codex-cli/node_modules/@openai/codex/bin/codex.js --version >/dev/null 2>&1; then
      codex_ready=1
      break
    fi
    if ! kill -0 "$codex_install_pid" >/dev/null 2>&1; then
      break
    fi
    sleep 2
  done
  if [ "$codex_ready" -ne 1 ]; then
    wait "$codex_install_pid"
    if [ -x /opt/oneworks-codex-cli/node_modules/@openai/codex/bin/codex.js ]; then
      /opt/oneworks-codex-cli/node_modules/@openai/codex/bin/codex.js --version >/dev/null
      codex_ready=1
    fi
  fi
  if [ "$codex_ready" -ne 1 ]; then
    echo "Codex CLI was not ready after ${codexCliInstallTimeoutSeconds}s" >&2
    exit 1
  fi
  if kill -0 "$codex_install_pid" >/dev/null 2>&1; then
    kill "$codex_install_pid" >/dev/null 2>&1 || true
    wait "$codex_install_pid" >/dev/null 2>&1 || true
  fi
  touch /opt/oneworks-codex-cli/.oneworks-codex-installed
fi
`
        : ''
    }

cd /opt/oneworks-daemon
exec env \\
  __ONEWORKS_BOOTSTRAP_PREFER_LOCAL_RUNTIME__=true \\
${
      verifyAgent
        ? `  __ONEWORKS_PROJECT_ADAPTER_CODEX_CLI_PATH__=/opt/oneworks-codex-cli/node_modules/@openai/codex/bin/codex.js \\
  __ONEWORKS_PROJECT_ADAPTER_CODEX_CLI_AUTO_INSTALL__=false \\
`
        : ''
    }  __ONEWORKS_PROJECT_SERVER_HOST__=0.0.0.0 \\
  __ONEWORKS_PROJECT_SERVER_PORT__=${containerPort} \\
  __ONEWORKS_PROJECT_SERVER_ROLE__=manager \\
  __ONEWORKS_PROJECT_WEB_AUTH_ENABLED__=false \\
  __ONEWORKS_PROJECT_CONFIG_DIR__=/tmp/oneworks-linux-daemon/config \\
  __ONEWORKS_PROJECT_REAL_HOME__=/tmp/oneworks-linux-daemon/home \\
  __ONEWORKS_PROJECT_WORKSPACE_FOLDER__=/workspaces/linux-remote-a \\
  __ONEWORKS_PROJECT_WORKSPACE_FOLDER_RESOLVE_CWD__=/ \\
  HOME=/tmp/oneworks-linux-daemon/home \\
  npx oneworks daemon --host 0.0.0.0 --port ${containerPort} --workspace /workspaces/linux-remote-a --config-dir /tmp/oneworks-linux-daemon/config
`
  )
}

async function startDockerDaemon(tempDir) {
  await run('docker', ['version'])
  await run('docker', ['build', '-f', dockerfile, '-t', imageTag, dirname(dockerfile)])
  await run('docker', ['rm', '-f', containerName], { capture: true }).catch(() => undefined)
  await run('docker', [
    'run',
    '-d',
    '--name',
    containerName,
    '--add-host',
    'host.docker.internal:host-gateway',
    '-p',
    `${containerPort}:${containerPort}`,
    '--mount',
    `type=bind,source=${tempDir},target=/seed,readonly`,
    '--mount',
    `type=volume,source=${containerName}-pnpm-store,target=/pnpm/store`,
    imageTag,
    'bash',
    '-lc',
    [
      'set -euo pipefail',
      'bash /seed/entrypoint.sh'
    ].join(' && ')
  ])
}

async function assertGlobalConfigSynced() {
  let lastError
  let lastRefreshBody
  let lastSummary
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      lastRefreshBody = await fetchJson(`${hostDaemonUrl}/api/plugins/relay/proxy/relay/config-refresh`, {
        method: 'POST',
        body: JSON.stringify({ serverId: 'local' })
      })
      const { stdout } = await run('docker', [
        'exec',
        containerName,
        'env',
        'GLOBAL_CONFIG_PATH=/tmp/oneworks-linux-daemon/home/.oneworks/.oo.config.json',
        'node',
        '-e',
        [
          'const fs = require("node:fs");',
          'const path = process.env.GLOBAL_CONFIG_PATH;',
          'const data = JSON.parse(fs.readFileSync(path, "utf8"));',
          'const codex = data?.adapters?.codex && typeof data.adapters.codex === "object" ? data.adapters.codex : {};',
          'const accounts = codex.accounts && typeof codex.accounts === "object" ? codex.accounts : {};',
          'const authAccounts = Object.entries(accounts).filter(([, account]) => account?.auth?.encoding === "base64" && typeof account.auth.token === "string" && account.auth.token.length > 0);',
          'const generatedTitleAccountKeys = Object.entries(accounts).filter(([, account]) => account?.title === "Codex").map(([key]) => key);',
          'console.log(JSON.stringify({',
          'globalConfigPath: path,',
          'accountKeys: Object.keys(accounts),',
          'authAccountKeys: authAccounts.map(([key]) => key),',
          'authAccountCount: authAccounts.length,',
          'generatedTitleAccountKeys,',
          'hasDefaultAccount: typeof codex.defaultAccount === "string" && codex.defaultAccount.length > 0,',
          'encodedAuthLength: authAccounts.reduce((total, [, account]) => total + account.auth.token.length, 0)',
          '}));'
        ].join('')
      ], { capture: true })
      lastSummary = JSON.parse(stdout.trim())
      if (
        lastSummary.authAccountCount > 0 &&
        lastSummary.encodedAuthLength > 0 &&
        Array.isArray(lastSummary.generatedTitleAccountKeys) &&
        lastSummary.generatedTitleAccountKeys.length === 0
      ) {
        return { refreshBody: lastRefreshBody, summary: lastSummary }
      }
    } catch (error) {
      lastError = error
    }
    await new Promise(resolvePromise => setTimeout(resolvePromise, 1_000))
  }
  throw new Error(
    `Docker daemon did not receive global Codex auth: ${
      JSON.stringify({
        lastError: lastError instanceof Error ? lastError.message : String(lastError),
        lastRefreshBody,
        lastSummary
      })
    }`
  )
}

async function assertRemoteWorkspaceFlow(relayAccount, expectedDeviceId) {
  const target = await waitForRelayDevice(relayAccount, expectedDeviceId)
  const listBody = await fetchJson(`${hostManagerUrl}/api/plugins/relay/proxy/relay/workspaces/directories`, {
    method: 'POST',
    body: JSON.stringify({
      deviceId: target.deviceId,
      directory: '/workspaces',
      serverId: target.serverId
    }),
    timeoutMs: remoteWorkspaceRequestTimeoutMs
  })
  const remoteWorkspace = await fetchJson(`${hostManagerUrl}/api/plugins/relay/proxy/relay/workspaces/open`, {
    method: 'POST',
    body: JSON.stringify({
      deviceId: target.deviceId,
      deviceName: target.deviceName,
      serverId: target.serverId,
      serverName: target.serverName,
      workspaceFolder
    }),
    timeoutMs: remoteWorkspaceRequestTimeoutMs
  })
  await waitForJson(`${remoteWorkspace.serverBaseUrl}/api/config`, { timeoutMs: remoteWorkspaceRequestTimeoutMs })

  const created = await fetchJson(`${hostManagerUrl}/api/plugins/relay/proxy/relay/workspaces/create`, {
    method: 'POST',
    body: JSON.stringify({
      deviceId: target.deviceId,
      parentDirectory: createWorkspaceParent,
      projectName: createWorkspaceName,
      serverId: target.serverId
    }),
    timeoutMs: remoteWorkspaceRequestTimeoutMs
  })
  const createdWorkspace = await fetchJson(`${hostManagerUrl}/api/plugins/relay/proxy/relay/workspaces/open`, {
    method: 'POST',
    body: JSON.stringify({
      deviceId: target.deviceId,
      deviceName: target.deviceName,
      serverId: target.serverId,
      serverName: target.serverName,
      workspaceFolder: created.workspaceFolder
    }),
    timeoutMs: remoteWorkspaceRequestTimeoutMs
  })
  await waitForJson(`${createdWorkspace.serverBaseUrl}/api/config`, { timeoutMs: remoteWorkspaceRequestTimeoutMs })

  return {
    createdWorkspace,
    directoryCount: Array.isArray(listBody?.directories) ? listBody.directories.length : undefined,
    target,
    workspace: remoteWorkspace
  }
}

async function assertOptionalAgentFlow(workspace) {
  if (!verifyAgent) return undefined
  const session = await fetchJson(`${workspace.serverBaseUrl}/api/sessions`, {
    method: 'POST',
    body: JSON.stringify({
      adapter: 'codex',
      initialMessage: '请只回复 ok-docker-global，用于验证 Linux Docker relay workspace 使用全局同步的 Codex 登录态。',
      model: agentModel,
      permissionMode: 'default',
      start: true,
      title: 'Docker remote relay global config sync session'
    })
  })
  const sessionId = session?.data?.session?.id ?? session?.session?.id ?? session?.id
  if (typeof sessionId !== 'string' || sessionId === '') {
    throw new Error(`Session create did not return an id: ${JSON.stringify(session)}`)
  }
  let messages = []
  const startedAt = Date.now()
  while (Date.now() - startedAt < agentReplyTimeoutMs) {
    const body = await fetchJson(
      `${workspace.serverBaseUrl}/api/sessions/${encodeURIComponent(sessionId)}/messages?limit=50`
    )
    const payload = isRecord(body?.data) ? body.data : body
    messages = Array.isArray(payload?.messages) ? payload.messages : []
    const text = JSON.stringify({
      messages,
      session: payload?.session
    })
    if (text.includes('ok-docker-global')) {
      return { model: agentModel, sessionId, status: 'ok' }
    }
    const sessionStatus = cleanText(payload?.session?.status)
    if (
      sessionStatus === 'failed' ||
      sessionStatus === 'terminated' ||
      text.includes('stream disconnected') ||
      text.includes('error sending request') ||
      text.includes('invalid_request_error')
    ) {
      throw new Error(`Docker agent session failed: ${text}`)
    }
    await new Promise(resolvePromise => setTimeout(resolvePromise, 2_000))
  }
  throw new Error(`Timed out after ${agentReplyTimeoutMs}ms waiting for Docker agent reply in session ${sessionId}`)
}

const main = async () => {
  const dockerTempRoot = resolve(repoRoot, '.logs/docker')
  await mkdir(dockerTempRoot, { recursive: true })
  const tempDir = await mkdtemp(resolve(dockerTempRoot, 'oneworks-codex-sync-'))

  const hostCodexConfig = await ensureHostCodexGlobalConfigPatch()
  const relayAccount = await ensureRelayPublishAccount()
  const personalConfig = await ensureRelayPersonalConfigPublished(hostCodexConfig.configPatch, relayAccount)
  const hostManagerRelayAccount = await ensureHostManagerRelayAccount(relayAccount)
  const hostManagerConnection = await ensureHostManagerRelayConnection(hostManagerRelayAccount)
  await prepareDockerFiles(tempDir, relayAccount)
  await startDockerDaemon(tempDir)
  await waitForJson(`${hostDaemonUrl}/api/plugins/relay/proxy/relay/status`, { timeoutMs: dockerDaemonReadyTimeoutMs })

  const dockerDevice = await waitForDockerRelayDeviceStore()
  const config = await assertGlobalConfigSynced()
  const remote = await assertRemoteWorkspaceFlow(relayAccount, dockerDevice.deviceId)
  const agent = await assertOptionalAgentFlow(remote.workspace)

  console.log(JSON.stringify(
    {
      agent,
      config: config.summary,
      containerName,
      hostDaemonUrl,
      hostManagerUrl,
      hostManagerConnection,
      personalConfig,
      hostCodexConfig: {
        accountKeys: hostCodexConfig.accountKeys,
        authAccountKeys: hostCodexConfig.authAccountKeys,
        defaultAccount: hostCodexConfig.defaultAccount,
        globalConfigPath: hostCodexConfig.globalConfigPath,
        wroteGlobalConfig: hostCodexConfig.wroteGlobalConfig
      },
      remote: {
        createdWorkspaceFolder: remote.createdWorkspace.workspaceFolder,
        createdWorkspaceId: remote.createdWorkspace.workspaceId,
        createdWorkspaceUrl: remote.createdWorkspace.serverBaseUrl,
        directoryCount: remote.directoryCount,
        deviceId: remote.target.deviceId,
        deviceStorePath: dockerDevice.storePath,
        deviceName: remote.target.deviceName,
        workspaceFolder: remote.workspace.workspaceFolder,
        workspaceId: remote.workspace.workspaceId,
        workspaceUrl: remote.workspace.serverBaseUrl
      }
    },
    null,
    2
  ))
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
