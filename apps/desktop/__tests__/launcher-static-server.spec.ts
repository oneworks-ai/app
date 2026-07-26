import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { startPackagedLauncherStaticServer } from '../src/main/launcher-static-server'

const createdPaths: string[] = []
const servers: Array<{ close: () => Promise<void> }> = []

const createDistFixture = async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'ow-launcher-static-'))
  createdPaths.push(root)
  const distPath = path.join(root, 'dist')
  await mkdir(path.join(distPath, 'assets'), { recursive: true })
  await writeFile(
    path.join(distPath, 'index.html'),
    [
      '<!doctype html>',
      '<html>',
      '<head>',
      '<link rel="stylesheet" href="/__ONEWORKS_PROJECT_CLIENT_BASE__/assets/app.css">',
      '</head>',
      '<body>launcher</body>',
      '</html>'
    ].join('')
  )
  await writeFile(
    path.join(distPath, 'assets/app.css'),
    'body{font-family:Launcher;background:url(/__ONEWORKS_PROJECT_CLIENT_BASE__/assets/font.woff2)}'
  )
  await writeFile(path.join(distPath, 'assets/font.woff2'), 'font-data')
  await writeFile(path.join(distPath, 'sw.js'), 'self.addEventListener("install", () => {})')

  return distPath
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => server.close()))
  await Promise.all(createdPaths.splice(0).map(target => rm(target, { recursive: true, force: true })))
})

describe('launcher static server', () => {
  it('serves placeholder base assets used by packaged css', async () => {
    const distPath = await createDistFixture()
    const launcher = await startPackagedLauncherStaticServer({
      clientBase: '/ui',
      distPath,
      port: 0
    })
    servers.push({
      close: () =>
        new Promise<void>((resolve, reject) => {
          launcher.server.close(error => error == null ? resolve() : reject(error))
        })
    })

    const indexResponse = await fetch(`${launcher.clientUrl}`)
    expect(indexResponse.status).toBe(200)
    const indexHtml = await indexResponse.text()
    expect(indexHtml).toContain('/ui/assets/app.css')
    expect(indexHtml).toContain('window.__ONEWORKS_PROJECT_RUNTIME_ENV__=')

    const cssResponse = await fetch(`${launcher.clientUrl}assets/app.css`)
    expect(cssResponse.status).toBe(200)
    expect(cssResponse.headers.get('content-type')).toContain('text/css')
    expect(await cssResponse.text()).toContain('/__ONEWORKS_PROJECT_CLIENT_BASE__/assets/font.woff2')

    const placeholderFontResponse = await fetch(
      `${new URL(launcher.clientUrl).origin}/__ONEWORKS_PROJECT_CLIENT_BASE__/assets/font.woff2`
    )
    expect(placeholderFontResponse.status).toBe(200)
    expect(placeholderFontResponse.headers.get('content-type')).toContain('font/woff2')
    expect(await placeholderFontResponse.text()).toBe('font-data')

    const directFontResponse = await fetch(`${launcher.clientUrl}assets/font.woff2`)
    expect(directFontResponse.status).toBe(200)
    expect(await directFontResponse.text()).toBe('font-data')
  })

  it('proxies only scoped plugin assets from loopback runtime servers', async () => {
    const upstreamRequests: string[] = []
    const upstream = createServer((request, response) => {
      upstreamRequests.push(request.url ?? '')
      response.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8' })
      response.end(`export const asset = ${JSON.stringify(request.url)}`)
    })
    await new Promise<void>((resolve, reject) => {
      upstream.once('error', reject)
      upstream.listen(0, '127.0.0.1', () => resolve())
    })
    servers.push({
      close: () =>
        new Promise<void>((resolve, reject) => {
          upstream.close(error => error == null ? resolve() : reject(error))
        })
    })
    const upstreamPort = (upstream.address() as AddressInfo).port

    const distPath = await createDistFixture()
    const launcher = await startPackagedLauncherStaticServer({
      clientBase: '/ui',
      distPath,
      port: 0
    })
    servers.push({
      close: () =>
        new Promise<void>((resolve, reject) => {
          launcher.server.close(error => error == null ? resolve() : reject(error))
        })
    })

    const launcherOrigin = new URL(launcher.clientUrl).origin
    const encodedOrigin = encodeURIComponent(`http://127.0.0.1:${upstreamPort}`)
    const proxyBase = `${launcherOrigin}/__oneworks_plugin_runtime__/${encodedOrigin}`
    const entryResponse = await fetch(
      `${proxyBase}/api/plugins/relay/client/index.js?pluginVersion=3`
    )
    expect(entryResponse.status).toBe(200)
    expect(entryResponse.headers.get('content-type')).toContain('text/javascript')
    expect(await entryResponse.text()).toContain(
      '/api/plugins/relay/client/index.js?pluginVersion=3'
    )

    const chunkResponse = await fetch(`${proxyBase}/api/plugins/relay/client/chunk.js`)
    expect(chunkResponse.status).toBe(200)
    const sharedResponse = await fetch(`${proxyBase}/api/plugins/relay/shared/runtime.js`)
    expect(sharedResponse.status).toBe(200)
    expect(await sharedResponse.text()).toContain('/api/plugins/relay/shared/runtime.js')

    const headResponse = await fetch(`${proxyBase}/api/plugins/relay/client/index.js`, {
      method: 'HEAD'
    })
    expect(headResponse.status).toBe(200)
    expect(await headResponse.text()).toBe('')
    expect(upstreamRequests).toEqual([
      '/api/plugins/relay/client/index.js?pluginVersion=3',
      '/api/plugins/relay/client/chunk.js',
      '/api/plugins/relay/shared/runtime.js',
      '/api/plugins/relay/client/index.js'
    ])

    const remoteOriginResponse = await fetch(
      `${launcherOrigin}/__oneworks_plugin_runtime__/${encodeURIComponent('https://example.com')}` +
        '/api/plugins/relay/client/index.js'
    )
    expect(remoteOriginResponse.status).toBe(403)

    const unrelatedPathResponse = await fetch(
      `${proxyBase}/api/config`
    )
    expect(unrelatedPathResponse.status).toBe(403)
    expect(upstreamRequests).toHaveLength(4)
  })

  it('recovers when an upstream plugin asset response is interrupted', async () => {
    const upstream = createServer((_request, response) => {
      response.writeHead(200, {
        'Content-Length': '64',
        'Content-Type': 'text/javascript; charset=utf-8'
      })
      response.flushHeaders()
      response.write('export const partial = true')
      setImmediate(() => response.destroy())
    })
    await new Promise<void>((resolve, reject) => {
      upstream.once('error', reject)
      upstream.listen(0, '127.0.0.1', () => resolve())
    })
    servers.push({
      close: () =>
        new Promise<void>((resolve, reject) => {
          upstream.close(error => error == null ? resolve() : reject(error))
        })
    })
    const upstreamPort = (upstream.address() as AddressInfo).port

    const distPath = await createDistFixture()
    const launcher = await startPackagedLauncherStaticServer({
      clientBase: '/ui',
      distPath,
      port: 0
    })
    servers.push({
      close: () =>
        new Promise<void>((resolve, reject) => {
          launcher.server.close(error => error == null ? resolve() : reject(error))
        })
    })

    const launcherOrigin = new URL(launcher.clientUrl).origin
    const encodedOrigin = encodeURIComponent(`http://127.0.0.1:${upstreamPort}`)
    const interruptedAssetUrl =
      `${launcherOrigin}/__oneworks_plugin_runtime__/${encodedOrigin}` +
      '/api/plugins/relay/client/interrupted.js'
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const interruptedResponse = await fetch(interruptedAssetUrl)
      expect(interruptedResponse.status).toBe(500)
      expect(await interruptedResponse.text()).toBe('Failed to load UI')
      expect(errorSpy).toHaveBeenCalledWith(
        '[oneworks-client:launcher] failed to serve launcher client',
        expect.anything()
      )
    } finally {
      errorSpy.mockRestore()
    }

    const recoveryResponse = await fetch(`${launcher.clientUrl}assets/font.woff2`)
    expect(recoveryResponse.status).toBe(200)
    expect(await recoveryResponse.text()).toBe('font-data')
  })
})
