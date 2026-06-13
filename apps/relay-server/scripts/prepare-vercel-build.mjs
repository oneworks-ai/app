import { copyFile, cp, mkdir, rm } from 'node:fs/promises'

const serverDir = new URL('..', import.meta.url)
const publicDir = new URL('../public/', import.meta.url)
const publicAdminDir = new URL('../public/admin/', import.meta.url)
const adminDistDir = new URL('../../relay-admin/dist/', import.meta.url)
const adminStaticDir = new URL('../../relay-admin/dist/admin/', import.meta.url)

await rm(publicAdminDir, { force: true, recursive: true })
await mkdir(publicDir, { recursive: true })

await cp(adminStaticDir, publicAdminDir, { recursive: true })
await copyFile(
  new URL('../../relay-admin/dist/index.html', import.meta.url),
  new URL('../public/index.html', import.meta.url)
)

console.log(
  `[relay-server] Vercel admin assets copied from ${
    adminDistDir.pathname.replace(serverDir.pathname, '../relay-admin/dist/') || '../relay-admin/dist/'
  } to public/admin/`
)
