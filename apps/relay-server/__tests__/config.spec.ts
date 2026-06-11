import { afterEach, describe, expect, it, vi } from 'vitest'

import { VERSION, parseRelayServerArgs, printRelayServerHelp } from '../src/server.js'

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('relay server config', () => {
  it('parses CLI args and prints help without starting a server', () => {
    vi.stubEnv('ONEWORKS_RELAY_HOST', '0.0.0.0')
    vi.stubEnv('ONEWORKS_RELAY_ADMIN_TOKEN', 'env-admin')

    const args = parseRelayServerArgs([
      '--port',
      '9999',
      '--data',
      './relay.json',
      '--admin-token',
      'cli-admin',
      '--help'
    ])
    const output: string[] = []

    printRelayServerHelp(message => output.push(message))

    expect(args).toMatchObject({
      adminToken: 'cli-admin',
      dataPath: './relay.json',
      help: true,
      host: '0.0.0.0',
      port: 9999
    })
    expect(output.join('')).toContain(`OneWorks Relay Server ${VERSION}`)
  })
})
