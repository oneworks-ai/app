/* eslint-disable max-lines -- the parent protocol and isolated authority worker form one security boundary */
import { Buffer } from 'node:buffer'
import { spawn } from 'node:child_process'
import { lstatSync, realpathSync } from 'node:fs'
import path from 'node:path'
import { execPath } from 'node:process'

export interface FilesystemAuthorityIdentity {
  device: number
  inode: number
}

export interface FilesystemAuthorityOperations {
  afterDirectoryOpen?: (relativePath: string) => Promise<void> | void
  beforeDirectoryOpen?: (relativePath: string) => Promise<void> | void
  beforePostOpenIdentityCheck?: () => Promise<void> | void
}

interface AuthorityEvent {
  relativePath?: string
  type: 'after-directory-open' | 'before-directory-open' | 'before-file-identity-check'
}

const AUTHORITY_WORKER_SOURCE = String.raw`
const { Buffer } = require('node:buffer')
const fs = require('node:fs')

const config = JSON.parse(Buffer.from(process.argv[1], 'base64url').toString('utf8'))
const sameIdentity = (actual, expected) =>
  actual.dev === BigInt(expected.device) && actual.ino === BigInt(expected.inode)
const send = async event => {
  if (typeof process.send !== 'function') return
  await new Promise((resolve, reject) => {
    process.once('message', resolve)
    process.send(event, error => error == null ? undefined : reject(error))
  })
}
const assertSafeEntryName = name => {
  if (name === '' || name === '.' || name === '..' || name.includes('/') || name.includes('\\\\')) {
    throw new Error('Filesystem authority received an unsafe path component.')
  }
}
const readFile = async current => {
  const rootStat = fs.statSync('.', { bigint: true })
  if (!rootStat.isDirectory() || !sameIdentity(rootStat, current.rootIdentity)) return
  let relativePath = ''
  for (const component of current.directories) {
    assertSafeEntryName(component)
    const before = fs.lstatSync(component, { bigint: true })
    if (!before.isDirectory() || before.isSymbolicLink()) return
    relativePath = relativePath === '' ? component : relativePath + '/' + component
    await send({ relativePath, type: 'before-directory-open' })
    process.chdir(component)
    await send({ relativePath, type: 'after-directory-open' })
    const after = fs.statSync('.', { bigint: true })
    if (!after.isDirectory() || after.dev !== before.dev || after.ino !== before.ino) return
  }
  assertSafeEntryName(current.fileName)
  if (fs.constants.O_NOFOLLOW == null) throw new Error('No-follow file opens are unsupported.')
  const descriptor = fs.openSync(
    current.fileName,
    fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW
  )
  try {
    const before = fs.fstatSync(descriptor, { bigint: true })
    if (!before.isFile() || before.size > BigInt(current.maxBytes)) return
    if (current.expectedIdentity != null && !(
      before.dev === BigInt(current.expectedIdentity.device) &&
      before.ino === BigInt(current.expectedIdentity.inode) &&
      before.size === BigInt(current.expectedIdentity.size)
    )) return
    await send({ type: 'before-file-identity-check' })
    const pathIdentity = fs.lstatSync(current.fileName, { bigint: true })
    if (
      !pathIdentity.isFile() || pathIdentity.isSymbolicLink() ||
      pathIdentity.dev !== before.dev || pathIdentity.ino !== before.ino
    ) return
    const buffer = Buffer.allocUnsafe(current.maxBytes + 1)
    let totalBytes = 0
    while (totalBytes < buffer.length) {
      const bytesRead = fs.readSync(
        descriptor,
        buffer,
        totalBytes,
        buffer.length - totalBytes,
        totalBytes
      )
      if (bytesRead === 0) break
      totalBytes += bytesRead
    }
    if (totalBytes > current.maxBytes) return
    const after = fs.fstatSync(descriptor, { bigint: true })
    if (
      !after.isFile() || after.dev !== before.dev || after.ino !== before.ino ||
      after.size !== before.size || after.mtimeNs !== before.mtimeNs ||
      after.ctimeNs !== before.ctimeNs || BigInt(totalBytes) !== after.size
    ) return
    process.stdout.write(JSON.stringify({ content: buffer.subarray(0, totalBytes).toString('base64') }))
  } finally {
    fs.closeSync(descriptor)
  }
}

Promise.resolve()
  .then(() => readFile(config))
  .catch(error => {
    process.stderr.write(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
`

const encodeWorkerConfig = (value: unknown) => (
  Buffer.from(JSON.stringify(value)).toString('base64url')
)

const serializeIdentity = (identity: FilesystemAuthorityIdentity) => ({
  device: String(identity.device),
  inode: String(identity.inode)
})

const runAuthorityWorker = async (params: {
  config: Record<string, unknown>
  cwd: string
  maxOutputBytes: number
  operations?: FilesystemAuthorityOperations
}) =>
  new Promise<Buffer>((resolve, reject) => {
    const child = spawn(
      execPath,
      ['--eval', AUTHORITY_WORKER_SOURCE, encodeWorkerConfig(params.config)],
      { cwd: params.cwd, env: {}, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] }
    )
    const output: Buffer[] = []
    const errors: Buffer[] = []
    let outputBytes = 0
    let callbackError: unknown
    child.stdout!.on('data', (chunk: Buffer) => {
      outputBytes += chunk.length
      if (outputBytes > params.maxOutputBytes) {
        callbackError = new Error('Filesystem authority worker exceeded its output bound.')
        child.kill()
        return
      }
      output.push(chunk)
    })
    child.stderr!.on('data', (chunk: Buffer) => errors.push(chunk))
    child.on('message', (event: AuthorityEvent) => {
      void Promise.resolve()
        .then(async () => {
          if (event.type === 'before-directory-open') {
            await params.operations?.beforeDirectoryOpen?.(event.relativePath ?? '')
          } else if (event.type === 'after-directory-open') {
            await params.operations?.afterDirectoryOpen?.(event.relativePath ?? '')
          } else {
            await params.operations?.beforePostOpenIdentityCheck?.()
          }
        })
        .then(() => child.send({ type: 'continue' }))
        .catch((error) => {
          callbackError = error
          child.kill()
        })
    })
    child.on('error', reject)
    child.on('close', (code) => {
      if (callbackError != null) {
        reject(callbackError)
        return
      }
      if (code !== 0) {
        reject(new Error(Buffer.concat(errors).toString('utf8') || 'Filesystem authority worker failed.'))
        return
      }
      resolve(Buffer.concat(output))
    })
  })

const readDirectoryIdentity = (directory: string) => {
  const directoryStat = lstatSync(directory)
  if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) {
    throw new Error('Filesystem authority root is unsafe.')
  }
  return {
    device: directoryStat.dev,
    inode: directoryStat.ino
  }
}

export const readBoundedRegularFileBeneath = async (params: {
  canonicalParent: string
  expectedIdentity?: FilesystemAuthorityIdentity & { size: number }
  filePath: string
  maxBytes: number
  operations?: FilesystemAuthorityOperations
}): Promise<Buffer | undefined> => {
  if (realpathSync(params.canonicalParent) !== params.canonicalParent) return undefined
  const relativePath = path.relative(params.canonicalParent, params.filePath)
  if (
    relativePath === '' || path.isAbsolute(relativePath) ||
    relativePath === '..' || relativePath.startsWith(`..${path.sep}`)
  ) return undefined
  const components = relativePath.split(path.sep)
  const fileName = components.pop()
  if (fileName == null || fileName === '') return undefined
  const rootIdentity = readDirectoryIdentity(params.canonicalParent)
  const output = await runAuthorityWorker({
    config: {
      directories: components,
      expectedIdentity: params.expectedIdentity == null
        ? undefined
        : {
          device: String(params.expectedIdentity.device),
          inode: String(params.expectedIdentity.inode),
          size: String(params.expectedIdentity.size)
        },
      fileName,
      maxBytes: params.maxBytes,
      mode: 'read',
      rootIdentity: serializeIdentity(rootIdentity)
    },
    cwd: params.canonicalParent,
    maxOutputBytes: Math.ceil(params.maxBytes * 4 / 3) + 64,
    operations: params.operations
  }).catch(() => undefined)
  if (output == null || output.length === 0) return undefined
  try {
    const parsed = JSON.parse(output.toString('utf8')) as { content?: unknown }
    return typeof parsed.content === 'string'
      ? Buffer.from(parsed.content, 'base64')
      : undefined
  } catch {
    return undefined
  }
}
