import { spawn } from 'node:child_process'
import { mkdir, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import process from 'node:process'

const workspace = process.env.GITHUB_WORKSPACE ?? process.cwd()

export function getVercelLayout(workspaceRoot) {
  const relayDir = join(workspaceRoot, 'apps/relay-server')
  const buildLinkDir = join(relayDir, '.vercel')
  const deployLinkDir = join(workspaceRoot, '.vercel')
  return {
    buildLinkDir,
    buildOutputDir: join(buildLinkDir, 'output'),
    deployLinkDir,
    deployOutputDir: join(deployLinkDir, 'output'),
    relayDir
  }
}

const { buildLinkDir, buildOutputDir, deployLinkDir, deployOutputDir, relayDir } = getVercelLayout(workspace)

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: relayDir, env: process.env, stdio: 'inherit', ...options })
    child.once('error', reject)
    child.once('exit', (code) => code === 0 ? resolve() : reject(new Error(`${command} exited with ${code}`)))
  })
}

export async function findProjectId({ domain, fetchImpl, orgId, token }) {
  const request = async (path) => {
    const response = await fetchImpl(`https://api.vercel.com${path}`, {
      headers: { Authorization: `Bearer ${token}` }
    })
    if (!response.ok) throw new Error(`Vercel API request failed: ${response.status}`)
    return response.json()
  }
  const teamId = encodeURIComponent(orgId)
  const projects = []
  let until
  do {
    const suffix = until == null ? `?teamId=${teamId}&limit=100` : `?teamId=${teamId}&limit=100&until=${until}`
    const page = await request(`/v9/projects${suffix}`)
    projects.push(...(page.projects ?? []))
    until = page.pagination?.next ?? null
  } while (until != null)
  const matches = []
  for (const project of projects) {
    const domains = await request(`/v9/projects/${encodeURIComponent(project.id)}/domains?teamId=${teamId}`)
    if ((domains.domains ?? []).some((entry) => entry.name === domain)) matches.push(project.id)
  }
  if (matches.length !== 1) {
    throw new Error(`Expected exactly one Vercel project for ${domain}, found ${matches.length}`)
  }
  return matches[0]
}

async function resolveProjectId({ candidate }) {
  if (candidate) return candidate
  const domain = new URL(process.env.RELAY_PROD_VC_ORIGIN || 'https://vc.oneworks.cloud').hostname
  return findProjectId({ domain, fetchImpl: fetch, orgId: process.env.VERCEL_ORG_ID, token: process.env.VERCEL_TOKEN })
}

export function chooseCredentials(env) {
  const prod = [env.PROD_TOKEN, env.PROD_ORG_ID]
  if (!prod.every(Boolean)) throw new Error('Vercel production token and org id must be configured together.')
  return prod
}

export function selectProjectCandidate(env) {
  if (env.PROD_PROJECT_ID) return env.PROD_PROJECT_ID
  if (env.EXPLICIT_PROJECT_ID) return env.EXPLICIT_PROJECT_ID
  return undefined
}

export function createSmokeEnv({ expectedProviders, home, origin, path, sha, version }) {
  return {
    HOME: home,
    PATH: path,
    RELAY_EXPECTED_BUILD_SHA: sha,
    ...(expectedProviders == null ? {} : { RELAY_EXPECTED_SSO_PROVIDERS: expectedProviders }),
    RELAY_SMOKE_READY_ATTEMPTS: '30',
    RELAY_EXPECTED_TRANSPORT: 'v2-long-poll',
    RELAY_EXPECTED_VERSION: version,
    RELAY_ORIGIN: origin
  }
}

async function smoke() {
  const origin = process.env.RELAY_PROD_VC_ORIGIN || 'https://vc.oneworks.cloud'
  const version = process.env.npm_package_version ??
    (await import(join(relayDir, 'package.json'), { with: { type: 'json' } })).default.version
  await run(process.execPath, ['.github/workflows/scripts/relay-dev-smoke.mjs'], {
    cwd: workspace,
    env: createSmokeEnv({
      expectedProviders: process.env.RELAY_PROD_EXPECTED_SSO_PROVIDERS,
      home: process.env.HOME,
      origin,
      path: process.env.PATH,
      sha: process.env.GITHUB_SHA,
      version
    })
  })
}

async function main() {
  const [token, orgId] = chooseCredentials(process.env)
  const projectCandidate = selectProjectCandidate(process.env)
  process.env.VERCEL_TOKEN = token
  process.env.VERCEL_ORG_ID = orgId
  for (
    const name of [
      'PROD_TOKEN',
      'PROD_ORG_ID',
      'PROD_PROJECT_ID',
      'EXPLICIT_PROJECT_ID'
    ]
  ) delete process.env[name]
  const projectId = await resolveProjectId({ candidate: projectCandidate })
  for (const value of [token, orgId, projectId]) console.log(`::add-mask::${value}`)
  process.env.VERCEL_PROJECT_ID = projectId
  try {
    await mkdir(buildLinkDir, { recursive: true })
    await mkdir(deployLinkDir, { recursive: true })
    const projectJson = JSON.stringify({ orgId, projectId })
    await Promise.all([
      writeFile(join(buildLinkDir, 'project.json'), projectJson),
      writeFile(join(deployLinkDir, 'project.json'), projectJson)
    ])
    await run('pnpm', [
      'dlx',
      `vercel@${process.env.VERCEL_VERSION}`,
      'pull',
      '--environment=production',
      '--yes',
      '--token',
      token
    ])
    await run('pnpm', ['dlx', `vercel@${process.env.VERCEL_VERSION}`, 'build', '--prod', '--yes', '--token', token])
    await run('pnpm', ['prepare:vercel-output'])
    await rm(deployOutputDir, { force: true, recursive: true })
    await rename(buildOutputDir, deployOutputDir)
    await run('pnpm', [
      'dlx',
      `vercel@${process.env.VERCEL_VERSION}`,
      'deploy',
      '--prebuilt',
      '--prod',
      '--yes',
      '--token',
      token,
      '--env',
      `ONEWORKS_RELAY_BUILD_SHA=${process.env.GITHUB_SHA}`
    ], { cwd: workspace })
    await smoke()
  } finally {
    await rm(buildLinkDir, { force: true, recursive: true })
    await rm(deployLinkDir, { force: true, recursive: true })
  }
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) void main()
