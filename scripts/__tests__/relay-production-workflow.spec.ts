import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const workflow = readFileSync(resolve(process.cwd(), '.github/workflows/deploy-relay-server.yml'), 'utf8')
const devWorkflow = readFileSync(resolve(process.cwd(), '.github/workflows/deploy-relay-dev.yml'), 'utf8')

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
})
