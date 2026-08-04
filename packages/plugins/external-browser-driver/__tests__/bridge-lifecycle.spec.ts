import { mkdir, mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { ChromeExtensionBridge } from '../server/src/bridge.js'

const resources: Array<{ bridge: ChromeExtensionBridge; root: string }> = []

afterEach(async () => {
  await Promise.all(
    resources.splice(0).map(async ({ bridge, root }) => {
      await bridge.dispose()
      await rm(root, { force: true, recursive: true })
    })
  )
})

describe('chrome extension bridge lifecycle', () => {
  it('closes its listening server when credential initialization fails', async () => {
    const root = await mkdtemp(join(tmpdir(), 'oneworks-chrome-startup-failure-test-'))
    const bridge = new ChromeExtensionBridge({
      logger: { error() {}, info() {}, warn() {} },
      projectHome: join(root, 'project'),
      workspaceFolder: root
    })
    const blockedCredentialPath = join(root, 'credential-target')
    ;(bridge as unknown as { credentialPath: string }).credentialPath = blockedCredentialPath
    await rm(blockedCredentialPath, { force: true, recursive: true })
    await mkdir(blockedCredentialPath)

    try {
      await expect(bridge.start()).rejects.toThrow()
      expect(bridge.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/)
      await expect(fetch(bridge.url!, { signal: AbortSignal.timeout(500) })).rejects.toThrow()
    } finally {
      await bridge.dispose()
      await rm(root, { force: true, recursive: true })
    }
  })

  it('does not rewrite unchanged idle credentials on every refresh interval', async () => {
    const root = await mkdtemp(join(tmpdir(), 'oneworks-chrome-idle-credential-test-'))
    const bridge = new ChromeExtensionBridge({
      logger: { error() {}, info() {}, warn() {} },
      projectHome: join(root, 'project'),
      workspaceFolder: root
    })
    await bridge.start()
    resources.push({ bridge, root })
    const before = await stat(bridge.credentialPath)

    await new Promise(resolveWait => setTimeout(resolveWait, 2_200))

    const after = await stat(bridge.credentialPath)
    expect(after.mtimeMs).toBe(before.mtimeMs)
  })

  it('does not let an older same-process bridge reclaim credentials from its replacement', async () => {
    const root = await mkdtemp(join(tmpdir(), 'oneworks-chrome-replaced-bridge-test-'))
    const options = {
      logger: { error() {}, info() {}, warn() {} },
      projectHome: join(root, 'project'),
      workspaceFolder: root
    }
    const first = new ChromeExtensionBridge(options)
    const second = new ChromeExtensionBridge(options)
    await first.start()
    await new Promise(resolveWait => setTimeout(resolveWait, 500))
    await second.start()
    resources.push({ bridge: first, root }, { bridge: second, root })

    await new Promise(resolveWait => setTimeout(resolveWait, 1_750))

    const credential = JSON.parse(await readFile(second.credentialPath, 'utf8'))
    expect(credential).toMatchObject({ baseUrl: second.url, controlToken: second.controlToken })
  })
})
