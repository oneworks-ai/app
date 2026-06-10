import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

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
})
