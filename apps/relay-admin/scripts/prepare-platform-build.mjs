import { copyFile, mkdir, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const appDir = new URL('..', import.meta.url)
const distDir = new URL('../dist/', import.meta.url)
const adminDir = new URL('../dist/admin/', import.meta.url)
const assetsDir = new URL('../dist/admin/assets/', import.meta.url)

const adminHtml = `<!doctype html>
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
</html>
`

const redirects = `${
  [
    '/admin/assets/* /admin/assets/:splat 200',
    '/admin/* /admin/index.html 200',
    '/ /admin/index.html 200',
    '/* /admin/index.html 200'
  ].join('\n')
}\n`

const copyIfExists = async (source, target) => {
  try {
    await copyFile(source, target)
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }
}

await mkdir(adminDir, { recursive: true })
await mkdir(assetsDir, { recursive: true })

for (const filename of await readdir(distDir)) {
  if (!filename.endsWith('.js') && !filename.endsWith('.css')) continue
  await copyIfExists(
    new URL(`../dist/${filename}`, import.meta.url),
    new URL(`../dist/admin/assets/${filename}`, import.meta.url)
  )
}

const publicDir = new URL('../public/', import.meta.url)
for (const filename of await readdir(publicDir).catch(() => [])) {
  await copyIfExists(join(publicDir.pathname, filename), new URL(`../dist/admin/assets/${filename}`, import.meta.url))
}

await writeFile(new URL('../dist/admin/index.html', import.meta.url), adminHtml)
await writeFile(new URL('../dist/index.html', import.meta.url), adminHtml)
await writeFile(new URL('../dist/_redirects', import.meta.url), redirects)

console.log(`[relay-admin] platform build ready at ${distDir.pathname.replace(appDir.pathname, '') || 'dist/'}`)
