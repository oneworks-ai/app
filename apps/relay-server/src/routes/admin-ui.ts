import { readFile } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import process from 'node:process'

import type { RelayServerArgs } from '../types.js'

const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <link rel="icon" type="image/svg+xml" href="/admin/assets/favicon-dark.svg">
  <link rel="icon" type="image/svg+xml" href="/admin/assets/favicon-light.svg" media="(prefers-color-scheme: light)">
  <link rel="icon" type="image/svg+xml" href="/admin/assets/favicon-dark.svg" media="(prefers-color-scheme: dark)">
  <title>OneWorks Relay Admin</title>
  <link rel="stylesheet" href="/admin/assets/admin.css">
</head>
<body>
  <div id="root"></div>
  <script type="module" src="/admin/assets/admin.js"></script>
</body>
</html>`

const resolveAssetContentType = (filename: string) => {
  if (filename === 'admin.css') return 'text/css; charset=utf-8'
  if (filename.endsWith('.svg')) return 'image/svg+xml; charset=utf-8'
  if (filename.endsWith('.js')) return 'application/javascript; charset=utf-8'
  return undefined
}

const isSafeAssetFilename = (filename: string) => (
  filename !== '' &&
  !filename.includes('/') &&
  !filename.includes('\\') &&
  !filename.includes('..')
)

const resolvePackage = createRequire(__filename).resolve

const resolveAdminAssetsDir = () => {
  try {
    return join(dirname(resolvePackage('@oneworks/relay-admin/package.json')), 'dist')
  } catch {
    return join(process.cwd(), 'apps', 'relay-admin', 'dist')
  }
}

const readAsset = async (filename: string) => await readFile(join(resolveAdminAssetsDir(), filename))

export const handleAdminPage = (_req: IncomingMessage, res: ServerResponse, args: RelayServerArgs) => {
  res.writeHead(200, {
    'content-type': 'text/html; charset=utf-8',
    'access-control-allow-origin': args.allowOrigin
  })
  res.end(html)
}

export const handleAdminAsset = async (
  _req: IncomingMessage,
  res: ServerResponse,
  args: RelayServerArgs,
  url: URL
) => {
  const filename = decodeURIComponent(url.pathname.slice('/admin/assets/'.length))
  if (!isSafeAssetFilename(filename)) {
    res.writeHead(404, {
      'content-type': 'text/plain; charset=utf-8',
      'access-control-allow-origin': args.allowOrigin
    })
    res.end('Not found.')
    return
  }
  const contentType = resolveAssetContentType(filename)
  if (contentType == null) {
    res.writeHead(404, {
      'content-type': 'text/plain; charset=utf-8',
      'access-control-allow-origin': args.allowOrigin
    })
    res.end('Not found.')
    return
  }
  try {
    const content = await readAsset(filename)
    res.writeHead(200, {
      'content-type': contentType,
      'cache-control': 'no-cache',
      'access-control-allow-origin': args.allowOrigin
    })
    res.end(content)
  } catch {
    res.writeHead(404, {
      'content-type': 'text/plain; charset=utf-8',
      'access-control-allow-origin': args.allowOrigin
    })
    res.end('Not found.')
  }
}

export const handleAdminUi = handleAdminPage
