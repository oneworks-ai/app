import { spawn } from 'node:child_process'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import process from 'node:process'

const workspace = process.env.GITHUB_WORKSPACE ?? process.cwd()
const relayDir = join(workspace, 'apps/relay-server')
const vercelDir = join(relayDir, '.vercel')

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: relayDir, env: process.env, stdio: 'inherit', ...options })
    child.once('error', reject)
    child.once('exit', (code) => code === 0 ? resolve() : reject(new Error(`${command} exited with ${code}`)))
  })
}

export async function findProjectId({ fetchImpl, orgId, token }) {
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
    if ((domains.domains ?? []).some((domain) => domain.name === 'vc.oneworks.cloud')) matches.push(project.id)
  }
  if (matches.length !== 1) {
    throw new Error(`Expected exactly one Vercel project for vc.oneworks.cloud, found ${matches.length}`)
  }
  return matches[0]
}

async function resolveProjectId() {
  const explicit = process.env.PROD_PROJECT_ID || process.env.EXPLICIT_PROJECT_ID
  return explicit ||
    findProjectId({ fetchImpl: fetch, orgId: process.env.VERCEL_ORG_ID, token: process.env.VERCEL_TOKEN })
}

function chooseCredentials() {
  const prod = [process.env.PROD_TOKEN, process.env.PROD_ORG_ID]
  if (prod.filter(Boolean).length === 1) {
    throw new Error('Vercel production token and org id must be configured together.')
  }
  if (prod.every(Boolean)) return prod
  const dev = [process.env.DEV_TOKEN, process.env.DEV_ORG_ID]
  if (!dev.every(Boolean)) throw new Error('Vercel production credential pair and migration fallback are incomplete.')
  console.log('::notice::Using the migration fallback Vercel credential pair for this production promotion.')
  return dev
}

async function smoke() {
  const origin = process.env.RELAY_PROD_VC_ORIGIN || 'https://vc.oneworks.cloud'
  const version = process.env.npm_package_version ??
    (await import(join(relayDir, 'package.json'), { with: { type: 'json' } })).default.version
  for (let attempt = 1; attempt <= 30; attempt += 1) {
    console.log(`Production Vercel smoke attempt ${attempt}/30 against ${origin}`)
    try {
      await run(process.execPath, ['.github/workflows/scripts/relay-dev-smoke.mjs'], {
        cwd: workspace,
        env: {
          ...process.env,
          RELAY_ORIGIN: origin,
          RELAY_EXPECTED_BUILD_SHA: process.env.GITHUB_SHA,
          RELAY_EXPECTED_VERSION: version
        }
      })
      return
    } catch {
      if (attempt === 30) throw new Error(`Vercel production did not become healthy at ${origin} within 10 minutes.`)
      await new Promise((resolve) => setTimeout(resolve, 20_000))
    }
  }
}

async function main() {
  const [token, orgId] = chooseCredentials()
  process.env.VERCEL_TOKEN = token
  process.env.VERCEL_ORG_ID = orgId
  const projectId = await resolveProjectId()
  for (const value of [token, orgId, projectId]) console.log(`::add-mask::${value}`)
  process.env.VERCEL_PROJECT_ID = projectId
  try {
    await mkdir(vercelDir, { recursive: true })
    await writeFile(join(vercelDir, 'project.json'), JSON.stringify({ orgId, projectId }))
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
    ])
    await smoke()
  } finally {
    await rm(vercelDir, { force: true, recursive: true })
  }
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) void main()
