import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import http from 'node:http'
import { tmpdir } from 'node:os'
import path from 'node:path'

import Router from '@koa/router'
import Koa from 'koa'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { pluginsRouter } from '#~/routes/plugins.js'
import { listSafeNativeHostPluginAssets } from '#~/services/plugins/native-host-assets.js'

const mocks = vi.hoisted(() => ({ listNativeHostPluginAssets: vi.fn() }))

vi.mock('#~/services/plugins/native-host.js', () => ({
  listNativeHostPluginAssets: mocks.listNativeHostPluginAssets,
  listNativeHostPlugins: vi.fn()
}))

describe('native plugin asset path identity', () => {
  const tempDirs: string[] = []
  let server: http.Server | undefined

  afterEach(async () => {
    await new Promise<void>(resolve => server?.close(() => resolve()) ?? resolve())
    server = undefined
    await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { force: true, recursive: true })))
    vi.clearAllMocks()
  })

  it.runIf(path.sep === '/')(
    'keeps literal backslash and separator assets distinct through the public route',
    async () => {
      const root = await mkdtemp(path.join(tmpdir(), 'oneworks-native-asset-path-'))
      tempDirs.push(root)
      await mkdir(path.join(root, 'rules', 'a'), { recursive: true })
      await writeFile(path.join(root, 'rules', 'a', 'b.md'), '# separator\n')
      await writeFile(path.join(root, 'rules', 'a\\b.md'), '# literal backslash\n')
      const groups = await listSafeNativeHostPluginAssets({
        adapter: 'codex',
        id: 'native-paths',
        name: 'native-paths',
        scope: 'user',
        source: { internalRoot: root, kind: 'installed-copy' },
        state: 'enabled'
      } as never)
      mocks.listNativeHostPluginAssets.mockResolvedValue(groups)

      const app = new Koa()
      const router = new Router({ prefix: '/api/plugins' })
      router.use(pluginsRouter().routes())
      app.use(router.routes())
      server = http.createServer(app.callback())
      await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', resolve))
      const address = server.address()
      if (address == null || typeof address === 'string') throw new Error('Missing test server address.')

      const response = await fetch(`http://127.0.0.1:${address.port}/api/plugins/native/native-paths/assets`)
      const payload = await response.json() as { groups: Array<{ files: Array<{ path: string }> }> }
      const paths = payload.groups.flatMap(group => group.files.map(file => file.path))

      expect(paths).toContain('rules/a/b.md')
      expect(paths).toContain('rules/a\\b.md')
      expect(new Set(paths).size).toBe(paths.length)
    }
  )
})
