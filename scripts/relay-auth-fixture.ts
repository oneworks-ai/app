/* eslint-disable max-lines -- relay account fixture scenarios stay colocated for quick visual QA switching. */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

import { ONEWORKS_AUTH_STORE_VERSION, resolveOneWorksAuthStorePath } from '@oneworks/utils/auth-store'

type RelayAuthFixtureScenario = 'multi-server-multi-user' | 'single-server-multi-user' | 'single-user'
type RelayAuthFixtureCommand = RelayAuthFixtureScenario | 'path' | 'restore'

interface FixtureAccount {
  accountKey: string
  email: string
  enabled: boolean
  loginId: string
  name: string
  role: string
  serverId: string
  serverUrl: string
  userId: string
  avatarUrl?: string
  sessionExpiresAt?: string
  sessionToken?: string
}

interface FixtureServer {
  id: string
  name: string
  platform: string
  url: string
  official?: boolean
}

const fixtureRoot = path.resolve('.logs', 'relay-auth-fixtures')
const backupPath = path.join(fixtureRoot, 'original-auth.json')

const localServer: FixtureServer = {
  id: 'local',
  name: 'Local',
  platform: 'Local',
  url: 'http://127.0.0.1:48888'
}

const teamServer: FixtureServer = {
  id: 'team',
  name: 'Team Workspace',
  platform: 'Cloudflare',
  url: 'https://relay.team.example.test'
}

const createAccount = (input: {
  email: string
  loginId: string
  name: string
  role: string
  server: FixtureServer
  userId: string
  avatarUrl?: string
}): FixtureAccount => ({
  accountKey: `${input.server.id}:${input.userId}`,
  email: input.email,
  enabled: true,
  loginId: input.loginId,
  name: input.name,
  role: input.role,
  serverId: input.server.id,
  serverUrl: input.server.url,
  sessionExpiresAt: '2026-07-21T15:17:59.211Z',
  sessionToken: `relay-fixture:${input.server.id}:${input.userId}`,
  userId: input.userId,
  ...(input.avatarUrl == null ? {} : { avatarUrl: input.avatarUrl })
})

const ownerLocal = createAccount({
  avatarUrl: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&w=96&h=96&q=80',
  email: 'owner@local.test',
  loginId: 'owner',
  name: 'Owner Local',
  role: 'owner',
  server: localServer,
  userId: 'owner'
})

const memberLocal = createAccount({
  email: 'member@local.test',
  loginId: 'member',
  name: 'Member Local',
  role: 'member',
  server: localServer,
  userId: 'member'
})

const ownerTeam = createAccount({
  email: 'owner@team.test',
  loginId: 'owner',
  name: 'Owner Team',
  role: 'owner',
  server: teamServer,
  userId: 'owner'
})

const memberTeam = createAccount({
  email: 'member@team.test',
  loginId: 'member',
  name: 'Member Team',
  role: 'member',
  server: teamServer,
  userId: 'member'
})

const fixtureScenarios: Record<RelayAuthFixtureScenario, {
  accounts: FixtureAccount[]
  servers: FixtureServer[]
}> = {
  'single-user': {
    accounts: [ownerLocal],
    servers: [localServer]
  },
  'single-server-multi-user': {
    accounts: [ownerLocal, memberLocal],
    servers: [localServer]
  },
  'multi-server-multi-user': {
    accounts: [ownerLocal, memberLocal, ownerTeam, memberTeam],
    servers: [localServer, teamServer]
  }
}

const readExistingAuth = async (authPath: string) => await readFile(authPath, 'utf8').catch(() => '')

const ensureBackup = async (authPath: string) => {
  await mkdir(fixtureRoot, { recursive: true })
  const existingBackup = await readFile(backupPath, 'utf8').catch(() => undefined)
  if (existingBackup != null) return
  await writeFile(backupPath, await readExistingAuth(authPath), 'utf8')
}

const writeJsonAtomic = async (targetPath: string, value: unknown) => {
  await mkdir(path.dirname(targetPath), { recursive: true, mode: 0o700 })
  const tempPath = `${targetPath}.${process.pid}.${Date.now()}.tmp`
  await writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600
  })
  await rename(tempPath, targetPath)
}

const buildStore = (scenario: RelayAuthFixtureScenario) => {
  const fixture = fixtureScenarios[scenario]
  return {
    accounts: fixture.accounts,
    servers: Object.fromEntries(fixture.servers.map(server => [server.id, server])),
    version: ONEWORKS_AUTH_STORE_VERSION
  }
}

const restoreOriginal = async (authPath: string) => {
  const backup = await readFile(backupPath, 'utf8').catch(() => undefined)
  if (backup == null) {
    throw new Error(`No relay auth fixture backup found at ${backupPath}`)
  }
  await mkdir(path.dirname(authPath), { recursive: true, mode: 0o700 })
  await writeFile(authPath, backup, {
    encoding: 'utf8',
    mode: 0o600
  })
}

export const relayAuthFixtureCommands = [
  'multi-server-multi-user',
  'path',
  'restore',
  'single-server-multi-user',
  'single-user'
] as const

export const parseRelayAuthFixtureCommand = (value: string | undefined): RelayAuthFixtureCommand => {
  const command = value ?? 'multi-server-multi-user'
  if (relayAuthFixtureCommands.includes(command as RelayAuthFixtureCommand)) {
    return command as RelayAuthFixtureCommand
  }
  throw new Error(`Unknown relay auth fixture command: ${command}`)
}

export const runRelayAuthFixture = async (input: {
  command: RelayAuthFixtureCommand
  json?: boolean
}) => {
  const authPath = resolveOneWorksAuthStorePath(process.env)
  if (input.command === 'path') {
    const result = { authPath, backupPath }
    if (input.json === true) {
      console.log(JSON.stringify(result, null, 2))
      return
    }
    console.log(`auth: ${authPath}`)
    console.log(`backup: ${backupPath}`)
    return
  }

  if (input.command === 'restore') {
    await restoreOriginal(authPath)
    const result = { authPath, backupPath, restored: true }
    if (input.json === true) {
      console.log(JSON.stringify(result, null, 2))
      return
    }
    console.log(`[relay-auth-fixture] restored ${authPath}`)
    return
  }

  await ensureBackup(authPath)
  const store = buildStore(input.command)
  await writeJsonAtomic(authPath, store)
  const result = {
    accounts: store.accounts.length,
    authPath,
    backupPath,
    command: input.command,
    servers: Object.keys(store.servers).length
  }
  if (input.json === true) {
    console.log(JSON.stringify(result, null, 2))
    return
  }
  console.log(`[relay-auth-fixture] ${input.command}`)
  console.log(`auth: ${authPath}`)
  console.log(`backup: ${backupPath}`)
  console.log(`accounts: ${store.accounts.length}`)
  console.log(`servers: ${Object.keys(store.servers).length}`)
  console.log(`restore: pnpm tools relay-auth-fixture restore`)
}
