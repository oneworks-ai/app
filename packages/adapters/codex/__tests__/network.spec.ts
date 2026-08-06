import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import {
  applyCodexNetworkEnv,
  materializeCodexCaCertificate
} from '#~/runtime/network.js'
import { matchesNoProxy } from '#~/runtime/proxy.js'

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

describe('codex network profile', () => {
  it('matches bare NO_PROXY domains, subdomains, whitespace, and ports', () => {
    const noProxy = 'example.com internal.test:8443,127.0.0.1 [::1]:9443'

    expect(matchesNoProxy(new URL('https://example.com'), noProxy)).toBe(true)
    expect(matchesNoProxy(new URL('https://api.example.com'), noProxy)).toBe(true)
    expect(matchesNoProxy(new URL('https://deep.internal.test:8443'), noProxy)).toBe(true)
    expect(matchesNoProxy(new URL('https://deep.internal.test:443'), noProxy)).toBe(false)
    expect(matchesNoProxy(new URL('http://127.0.0.1'), noProxy)).toBe(true)
    expect(matchesNoProxy(new URL('http://0.0.1'), noProxy)).toBe(false)
    expect(matchesNoProxy(new URL('https://[::1]:9443'), noProxy)).toBe(true)
  })

  it('materializes inline CA PEM for the native app-server environment', async () => {
    const homeDir = await mkdtemp(join(tmpdir(), 'codex-network-home-'))
    tempDirs.push(homeDir)
    const pem = '-----BEGIN CERTIFICATE-----\nZmFrZQ==\n-----END CERTIFICATE-----\n'

    const config = await materializeCodexCaCertificate({ caCertificate: pem }, homeDir)
    const env = applyCodexNetworkEnv({}, config)

    expect(config.caCertificate).not.toBe(pem)
    expect(env.CODEX_CA_CERTIFICATE).toBe(config.caCertificate)
    expect(env.SSL_CERT_FILE).toBe(config.caCertificate)
    await expect(readFile(config.caCertificate!, 'utf8')).resolves.toBe(pem)
    expect((await stat(config.caCertificate!)).mode & 0o777).toBe(0o600)
  })
})
