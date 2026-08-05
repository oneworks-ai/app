/** Runs relative to the pinned workspace object; #225 owns handle-relative publication. */
export const ASSET_PUBLISH_WORKER = String.raw`
import { randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { link, lstat, open } from 'node:fs/promises'
import { isAbsolute, join, sep } from 'node:path'
const [
  expectedRootDev,
  expectedRootIno,
  expectedDev,
  expectedIno,
  parentPath,
  targetName,
  fault = '',
  pausedStages = ''
] = process.argv.slice(1)
const pauses = new Set(pausedStages.split(',').filter(Boolean))
const emit = value => process.stdout.write('RESULT ' + JSON.stringify(value) + '\n')
const identityOf = stat => ({ dev: String(stat.dev), ino: String(stat.ino) })
const sameIdentity = (left, right) => left.dev === right.dev && left.ino === right.ino
const expectedParent = { dev: expectedDev, ino: expectedIno }
const targetPath = join(parentPath, targetName)
const warnings = new Set()
let visible = false
let stagingName
let stagingIdentity
let stagingHandle
let controlId = 0
const stage = async (name, details = {}, required = false) => {
  if (!required && !pauses.has(name)) return
  if (typeof process.send !== 'function') throw new Error('publisher-control-unavailable')
  const currentControlId = ++controlId
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      process.off('message', onMessage)
      reject(new Error('publisher-control-timeout'))
    }, 30_000)
    const onMessage = message => {
      if (
        message?.type !== 'asset-publish-continue' ||
        message.stage !== name ||
        message.controlId !== currentControlId
      ) return
      clearTimeout(timeout)
      process.off('message', onMessage)
      if (message.error) reject(new Error(message.error))
      else resolve()
    }
    process.on('message', onMessage)
    process.send({
      type: 'asset-publish-stage',
      stage: name,
      controlId: currentControlId,
      ...details
    })
  })
}
const readInput = async () => {
  const chunks = []
  let size = 0
  for await (const chunk of process.stdin) {
    size += chunk.length
    if (size > 64 * 1024) throw new Error('content-too-large')
    chunks.push(chunk)
  }
  return Buffer.concat(chunks)
}
const syncDirectory = async (stage, path) => {
  if (fault === stage) throw new Error('fault:' + stage)
  let handle
  try {
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
    await handle.sync()
    return true
  } catch (error) {
    if (process.platform === 'win32' && ['EINVAL', 'EISDIR', 'ENOTSUP', 'EPERM'].includes(error.code)) {
      return false
    }
    throw error
  } finally {
    await handle?.close()
  }
}
const verifyParent = async () => {
  let current = ''
  for (const part of parentPath.split(sep)) {
    if (part === '' || part === '.' || part === '..') throw new Error('invalid-parent')
    current = current === '' ? part : join(current, part)
    const stat = await lstat(current, { bigint: true })
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error('unsafe-parent')
  }
  return sameIdentity(identityOf(await lstat(parentPath, { bigint: true })), expectedParent)
}
const outcome = state => ({
  state,
  ...(warnings.size === 0 ? {} : { warnings: Array.from(warnings) })
})
const preCommitError = code => ({
  state: 'error',
  code,
  committed: false,
  ...(stagingName == null ? {} : { privateStaging: 'retained' })
})
let result
try {
  if (!/^[^/\\\u0000-\u001f]+\.md$/u.test(targetName)) throw new Error('invalid-target')
  const rootIdentity = identityOf(await lstat('.', { bigint: true }))
  if (
    !sameIdentity(rootIdentity, { dev: expectedRootDev, ino: expectedRootIno }) ||
    isAbsolute(parentPath) ||
    !await verifyParent()
  ) {
    result = preCommitError('asset_destination_changed')
  } else if (!await syncDirectory('authority-sync', parentPath)) {
    result = preCommitError('asset_durability_unsupported')
  } else {
    process.stdout.write('READY\n')
    const content = await readInput()
    const existing = await lstat(targetPath).catch(error => {
      if (error.code === 'ENOENT') return undefined
      throw error
    })
    if (existing != null) {
      result = preCommitError('asset_exists')
    } else {
      await stage('target-absent', {}, false)
      stagingName = '.asset-create-' + randomUUID() + '.tmp'
      stagingHandle = await open(
        stagingName,
        constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW,
        0o600
      )
      await stagingHandle.writeFile(content)
      await stagingHandle.sync()
      stagingIdentity = identityOf(await stagingHandle.stat({ bigint: true }))
      await stage('staged', { stagingName }, true)
      if (fault === 'crash-after-staging') process.exit(85)
      if (fault === 'prepublish') throw new Error('fault:prepublish')
      if (!await verifyParent()) throw new Error('parent-changed-before-publish')
      const currentStage = identityOf(await lstat(stagingName, { bigint: true }))
      if (!sameIdentity(currentStage, stagingIdentity)) throw new Error('staging-identity-changed')
      if (fault === 'disconnect-before-publishing') {
        process.disconnect()
        await new Promise(resolve => setTimeout(resolve, 50))
      }
      if (fault === 'delay-publishing') {
        await new Promise(resolve => setTimeout(resolve, 25))
      }
      await stage('publishing', {}, true)
      try {
        await link(stagingName, targetPath)
      } catch (error) {
        if (error.code === 'EEXIST') result = preCommitError('asset_exists')
        else throw error
      }
      if (result == null) {
        visible = true
        await stage('visible', {}, true)
        if (fault === 'response-after-visible') process.exit(86)
        const publishedIdentity = fault === 'identity-probe'
          ? undefined
          : identityOf(await lstat(targetPath, { bigint: true }))
        await stage('target-probed', {}, false)
        if (publishedIdentity == null || !sameIdentity(publishedIdentity, stagingIdentity)) {
          warnings.add('asset_target_identity_unconfirmed')
          result = outcome('committed-indeterminate')
        } else {
          try {
            if (!await syncDirectory('publish-sync', parentPath)) warnings.add('asset_parent_fsync_unsupported')
          } catch {
            warnings.add('asset_parent_fsync_failed')
            result = outcome('committed-indeterminate')
          }
          result ??= outcome('committed')
        }
      }
    }
  }
} catch {
  if (visible) {
    warnings.add('asset_publish_status_unconfirmed')
    result = outcome('committed-indeterminate')
  } else {
    result ??= preCommitError('asset_publish_failed')
  }
} finally {
  if (stagingName != null) warnings.add('asset_private_staging_retained')
  try {
    await stagingHandle?.close()
    if (fault === 'staging-close') throw new Error('fault:staging-close')
  } catch {
    warnings.add('asset_staging_handle_close_failed')
  }
  if (result?.state === 'committed') result = outcome('committed-degraded')
  else if (result?.state === 'committed-degraded' || result?.state === 'committed-indeterminate') {
    result = outcome(result.state)
  }
}
emit(result)
`
