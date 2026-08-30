import { execFileSync } from 'node:child_process'
import { readFileSync, readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const workflow = (name: string) => readFileSync(`.github/workflows/${name}`, 'utf8')
const releaseAutomationEnvironment = 'environment: $' +
  "{{ inputs.release_automation && 'Release Automation' || 'Production' }}"

function workflowJobs(workflowSource: string) {
  const jobsMarker = 'jobs:\n'
  const jobsStart = workflowSource.indexOf(jobsMarker)
  expect(jobsStart).toBeGreaterThanOrEqual(0)
  const jobsSource = workflowSource.slice(jobsStart + jobsMarker.length)
  const matches = Array.from(jobsSource.matchAll(/^ {2}([\w-]+):\n/gmu))

  return new Map(matches.map((match, index) => {
    const start = (match.index ?? 0) + match[0].length
    const end = matches[index + 1]?.index ?? jobsSource.length
    return [match[1]!, jobsSource.slice(start, end)]
  }))
}

function job(workflowSource: string, jobName: string) {
  const result = workflowJobs(workflowSource).get(jobName)
  expect(result).toBeDefined()
  return result!
}

interface WorkspaceManifest {
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  name?: string
  optionalDependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
}

const readManifest = (path: string) => JSON.parse(readFileSync(path, 'utf8')) as WorkspaceManifest

const getClientWorkspaceTriggerClosure = () => {
  const manifestPaths = execFileSync('git', ['ls-files', 'packages/**/package.json'], {
    encoding: 'utf8'
  }).trim().split('\n').filter(Boolean)
  const manifests = manifestPaths.map(path => ({ path, manifest: readManifest(path) }))
  const manifestsByName = new Map(
    manifests.flatMap(entry => entry.manifest.name == null ? [] : [[entry.manifest.name, entry]])
  )
  const clientManifest = readManifest('apps/client/package.json')
  const pending = Object.keys({
    ...clientManifest.dependencies,
    ...clientManifest.devDependencies,
    ...clientManifest.optionalDependencies,
    ...clientManifest.peerDependencies
  })
  const visited = new Set<string>()
  const triggerPaths = new Set<string>()

  while (pending.length > 0) {
    const packageName = pending.pop()!
    if (visited.has(packageName)) continue
    visited.add(packageName)
    const entry = manifestsByName.get(packageName)
    if (entry == null) continue

    const directory = entry.path.slice(0, -'/package.json'.length)
    const [, group] = directory.split('/')
    triggerPaths.add(group === 'adapters' || group === 'plugins' ? `packages/${group}/**` : `${directory}/**`)
    pending.push(...Object.keys({
      ...entry.manifest.dependencies,
      ...entry.manifest.devDependencies,
      ...entry.manifest.optionalDependencies,
      ...entry.manifest.peerDependencies
    }))
  }

  return triggerPaths
}

describe('workflow environment routing', () => {
  it('limits PWA production approvals to the explicit client workspace closure', () => {
    const source = workflow('deploy-pwa.yml')
    const triggerSource = source.slice(0, source.indexOf('\npermissions:'))

    expect(triggerSource).not.toContain('      - packages/**\n')
    expect(triggerSource).not.toContain('      - .github/workflows/deploy-pwa.yml\n')
    for (const clientPath of ['apps/client/**', ...getClientWorkspaceTriggerClosure()]) {
      expect(triggerSource).toContain(`      - ${clientPath}\n`)
    }
  })

  it.each([
    ['deploy-pwa.yml', 'trigger'],
    ['deploy-relay-admin.yml', 'deploy'],
    ['deploy-relay-server.yml', 'deploy-cloudflare'],
    ['deploy-relay-server.yml', 'deploy-vercel'],
    ['deploy-relay-server.yml', 'deploy-external'],
    ['npm-publish-alpha.yml', 'publish'],
    ['stable-windows-msi-release.yml', 'release'],
    ['vscode-extension-release.yml', 'release']
  ])('gates %s:%s with Production', (file, jobName) => {
    expect(job(workflow(file), jobName)).toContain('    environment: Production\n')
  })

  it('uses one pre-build Production gate for prerelease Desktop promotion', () => {
    const desktop = workflow('desktop-package.yml')
    const packageJob = job(desktop, 'desktop-package')
    const release = job(desktop, 'desktop-release')
    const homepage = job(desktop, 'desktop-homepage')
    const homepageTrigger = job(workflow('deploy-homepage.yml'), 'trigger')

    expect(packageJob).toContain("github.event_name == 'schedule' && 'Preview' || 'Production'")
    expect(release).toContain("&& 'Release Automation' || 'Production'")
    expect(release).toContain('      attestations: write\n')
    expect(release).toContain('      id-token: write\n')
    expect(release).toContain('uses: actions/attest@v4')
    expect(release).toContain('subject-path: release-artifacts/*')
    expect(homepage).toContain('release_automation: ${{ contains(inputs.release_tag || github.ref_name')
    expect(homepageTrigger).toContain(releaseAutomationEnvironment)
  })

  it('keeps Chrome mutations behind their dedicated gates', () => {
    const source = workflow('chrome-extension-release.yml')
    const build = job(source, 'build')
    const release = job(source, 'release')
    const store = job(source, 'publish-store')

    expect(build).not.toContain('environment:')
    expect(build).not.toContain('actions/attest')
    expect(build).not.toContain('attestations: write')
    expect(build).not.toContain('id-token: write')
    expect(release).toContain('    environment: Production\n')
    expect(release).toContain('      attestations: write\n')
    expect(release).toContain('      id-token: write\n')
    expect(release).toContain('uses: actions/attest@v4')
    expect(release).toContain('subject-path: dist/*.zip')
    expect(store).toContain('    environment: chrome-web-store\n')
  })

  it('uses Preview only for non-production release paths', () => {
    const previewJobs = readdirSync('.github/workflows')
      .filter(file => /\.ya?ml$/u.test(file))
      .flatMap(file => Array.from(workflowJobs(workflow(file))))
      .filter(([, source]) => /^ {4}environment: .*Preview/mu.test(source))
      .map(([name]) => name)
      .sort()

    expect(previewJobs).toEqual(['deploy-cloudflare-dev', 'desktop-package'])
    expect(job(workflow('deploy-relay-dev.yml'), 'deploy-cloudflare-dev'))
      .toContain('    environment: Preview\n')
    expect(job(workflow('desktop-package.yml'), 'desktop-package'))
      .toContain("github.event_name == 'schedule' && 'Preview' || 'Production'")
  })

  it('keeps pull-request planning ungated and isolates tag creation', () => {
    const source = workflow('release-tags.yml')
    const plan = job(source, 'plan')
    const createTags = job(source, 'create-tags')

    expect(plan).not.toContain('environment:')
    expect(plan).toContain('      contents: read\n')
    expect(plan).not.toContain('contents: write')
    expect(plan).not.toContain('actions: write')
    expect(createTags).toContain('    environment: Production\n')
    expect(createTags).toContain('    needs: plan\n')
    expect(createTags).toContain(
      "    if: github.event_name == 'push' && github.ref == 'refs/heads/main' && needs.plan.outputs.count != '0'\n"
    )
    expect(createTags).toContain('      actions: write\n')
    expect(createTags).toContain('      contents: write\n')
  })

  it('keeps reusable homepage deployment gating inside the called workflow', () => {
    const desktopHomepage = job(workflow('desktop-package.yml'), 'desktop-homepage')
    const homepageTrigger = job(workflow('deploy-homepage.yml'), 'trigger')

    expect(desktopHomepage).toContain('uses: ./.github/workflows/deploy-homepage.yml')
    expect(desktopHomepage).not.toContain('    environment:')
    expect(homepageTrigger).toContain(releaseAutomationEnvironment)
  })
})
