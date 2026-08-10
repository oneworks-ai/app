import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const workflow = readFileSync(resolve(process.cwd(), '.github/workflows/deploy-relay-server.yml'), 'utf8')
const devWorkflow = readFileSync(resolve(process.cwd(), '.github/workflows/deploy-relay-dev.yml'), 'utf8')
const relayCiWorkflow = readFileSync(resolve(process.cwd(), '.github/workflows/relay-ci.yml'), 'utf8')

describe('relay production workflow', () => {
  it('uses one platform-independent concurrency group for every production promotion', () => {
    const group = workflow.match(/concurrency:\n {2}group: ([^\n]+)/u)?.[1]

    expect(group).toBe('relay-server-production-global')
    expect(group).not.toContain('inputs.platform')
  })

  it('checks out the deployment script before the external job invokes it', () => {
    const externalJob = workflow.match(/ {2}deploy-external:\n([\s\S]+)$/u)?.[1]
    const checkout = externalJob?.indexOf('uses: actions/checkout@v4') ?? -1
    const script = externalJob?.indexOf('node .github/workflows/scripts/relay-external-production.mjs') ?? -1

    expect(checkout).toBeGreaterThanOrEqual(0)
    expect(script).toBeGreaterThan(checkout)
  })

  it('deploys Cloudflare development when Relay transport contracts change', () => {
    expect(devWorkflow).toContain('- packages/types/**')
  })

  it('runs deployment workflow tests when release scripts change', () => {
    expect(relayCiWorkflow).toContain('- .github/workflows/scripts/relay-*.mjs')
    expect(relayCiWorkflow).toContain('- scripts/__tests__/relay-*.spec.ts')
    expect(relayCiWorkflow).toContain('command: pnpm exec vitest run scripts/__tests__/relay-*.spec.ts')
  })

  it('waits for the Cloudflare dev custom domain to serve the deployed SHA', () => {
    const cloudflareDev = devWorkflow.match(/\x20{2}deploy-cloudflare-dev:\n([\s\S]+?)\n\x20{2}smoke-vercel-dev:/u)?.[1]
    const githubShaExpression = '$' + '{{ github.sha }}'

    expect(cloudflareDev).toContain(`RELAY_EXPECTED_BUILD_SHA: ${githubShaExpression}`)
    expect(cloudflareDev).toContain('RELAY_SMOKE_READY_ATTEMPTS: 30')
    expect(cloudflareDev).not.toContain('for attempt in $(seq 1 30)')
  })

  it('passes the production SSO provider contract to the Vercel deployment smoke', () => {
    const vercelProduction = workflow.match(/\x20{2}deploy-vercel:\n([\s\S]+?)\n\x20{2}deploy-external:/u)?.[1]
    const repositoryVariableExpression = '$' + '{{ vars.RELAY_PROD_EXPECTED_SSO_PROVIDERS }}'

    expect(vercelProduction).toContain(
      `RELAY_PROD_EXPECTED_SSO_PROVIDERS: ${repositoryVariableExpression}`
    )
  })

  it('builds shared types before bundling each Cloudflare Worker', () => {
    const cloudflareDev = devWorkflow.match(/\x20{2}deploy-cloudflare-dev:\n([\s\S]+?)\n\x20{2}smoke-vercel-dev:/u)?.[1]
    const cloudflareProduction = workflow.match(/\x20{2}deploy-cloudflare:\n([\s\S]+?)\n\x20{2}deploy-vercel:/u)?.[1]

    for (const cloudflareJob of [cloudflareDev, cloudflareProduction]) {
      const typesBuild = cloudflareJob?.indexOf('name: Build shared types artifact') ?? -1
      const adminBuild = cloudflareJob?.indexOf('name: Build Relay Admin Pages artifact') ?? -1
      const workerDeploy = cloudflareJob?.indexOf('Deploy Relay Worker') ?? -1

      expect(typesBuild).toBeGreaterThanOrEqual(0)
      expect(typesBuild).toBeLessThan(adminBuild)
      expect(typesBuild).toBeLessThan(workerDeploy)
    }
  })
})
