import { Buffer } from 'node:buffer'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { unzipSync, zipSync } from 'fflate'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { CHROME_EXTENSION_ID } from '../server/src/bridge.js'

const require = createRequire(import.meta.url)
const release = require('../bin/extension-release.cjs') as {
  archiveFileName: (flavor: 'base' | 'privileged', version?: string) => string
  chromeVersionFor: (version: string) => string
  stableExtensionId: string
}
const packager = require('../bin/package-extension.cjs') as {
  packageExtension: (input: { flavor: 'base' | 'privileged'; output: string }) => {
    archive: string
    extension_id: string
    flavor: string
    manifest_version: string
    package_version: string
    sha256: string
  }
}
const validator = require('../bin/validate-extension-package.cjs') as {
  validateExtensionArchive: (input: { archivePath: string; flavor: 'base' | 'privileged' }) => {
    extension_id: string
    flavor: string
    manifest_version: string
    package_version: string
    sha256: string
  }
}
const publisher = require('../bin/publish-chrome-web-store.cjs') as {
  publishChromeWebStore: (input: {
    accessToken: string
    apiRoot?: string
    archivePath: string
    extensionId: string
    fetchImpl: typeof fetch
    pollIntervalMs?: number
    publisherId: string
    sleep?: (milliseconds: number) => Promise<void>
  }) => Promise<Record<string, unknown>>
}

const temporaryDirectories: string[] = []

const temporaryDirectory = () => {
  const directory = mkdtempSync(join(tmpdir(), 'oneworks-extension-release-test-'))
  temporaryDirectories.push(directory)
  return directory
}

afterEach(() => {
  vi.restoreAllMocks()
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('external browser extension release packaging', () => {
  it('maps package prerelease versions to monotonic Chrome versions', () => {
    expect(release.chromeVersionFor('0.1.0-alpha.5')).toBe('0.1.0.10005')
    expect(release.chromeVersionFor('0.1.0-beta.5')).toBe('0.1.0.20005')
    expect(release.chromeVersionFor('0.1.0-rc.5')).toBe('0.1.0.30005')
    expect(release.chromeVersionFor('0.1.0')).toBe('0.1.0.65535')
    expect(release.chromeVersionFor('0.1.1-alpha.0')).toBe('0.1.1.10000')
    expect(() => release.chromeVersionFor('0.1.0-preview.1')).toThrow(/Unsupported/u)
    expect(() => release.chromeVersionFor('0.1.0-beta.5+rebuild.1')).toThrow(/Unsupported/u)
    expect(() => release.chromeVersionFor('01.1.0')).toThrow(/Unsupported/u)
    expect(() => release.chromeVersionFor('1.1.0-beta.01')).toThrow(/Unsupported/u)
    expect(() => release.chromeVersionFor('0.1.0-beta.10000')).toThrow(/between 0 and 9999/u)
  })

  it('creates deterministic base and privileged archives with root manifests and icons', () => {
    const directory = temporaryDirectory()
    const basePath = join(directory, 'base.zip')
    const secondBasePath = join(directory, 'base-again.zip')
    const privilegedPath = join(directory, 'privileged.zip')
    const secondPrivilegedPath = join(directory, 'privileged-again.zip')
    const originalTimezone = process.env.TZ
    let base: ReturnType<typeof packager.packageExtension>
    let secondBase: ReturnType<typeof packager.packageExtension>
    let privileged: ReturnType<typeof packager.packageExtension>
    let secondPrivileged: ReturnType<typeof packager.packageExtension>
    try {
      process.env.TZ = 'UTC'
      base = packager.packageExtension({ flavor: 'base', output: basePath })
      privileged = packager.packageExtension({ flavor: 'privileged', output: privilegedPath })
      process.env.TZ = 'America/Los_Angeles'
      secondBase = packager.packageExtension({ flavor: 'base', output: secondBasePath })
      secondPrivileged = packager.packageExtension({ flavor: 'privileged', output: secondPrivilegedPath })
    } finally {
      if (originalTimezone == null) delete process.env.TZ
      else process.env.TZ = originalTimezone
    }
    expect(base.sha256).toBe(secondBase.sha256)
    expect(privileged.sha256).toBe(secondPrivileged.sha256)
    expect(release.archiveFileName('privileged', '1.2.3')).toBe('oneworks-external-browser-v1.2.3.zip')
    expect(release.archiveFileName('base', '1.2.3')).toBe('oneworks-external-browser-v1.2.3-minimal.zip')
    expect(base).toMatchObject({ flavor: 'base', manifest_version: '0.1.0.20005' })
    expect(release.stableExtensionId).toBe(CHROME_EXTENSION_ID)
    expect(base).toMatchObject({ extension_id: CHROME_EXTENSION_ID })
    expect(privileged).toMatchObject({ flavor: 'privileged', manifest_version: '0.1.0.20005' })

    const baseEntries = unzipSync(new Uint8Array(readFileSync(basePath)))
    const baseManifest = JSON.parse(Buffer.from(baseEntries['manifest.json']).toString('utf8'))
    expect(Object.keys(baseEntries)).toEqual(expect.arrayContaining([
      'manifest.json',
      'background.js',
      'icons/icon-16.png',
      'icons/icon-32.png',
      'icons/icon-48.png',
      'icons/icon-128.png'
    ]))
    expect(baseManifest).toMatchObject({
      name: 'oneWorks External Browser (Minimal)',
      version: '0.1.0.20005',
      version_name: '0.1.0-beta.5'
    })
    expect(baseManifest.permissions).not.toContain('debugger')

    const privilegedEntries = unzipSync(new Uint8Array(readFileSync(privilegedPath)))
    const privilegedManifest = JSON.parse(Buffer.from(privilegedEntries['manifest.json']).toString('utf8'))
    expect(privilegedManifest.name).toBe('oneWorks External Browser')
    expect(privilegedManifest.permissions).toEqual(expect.arrayContaining(['debugger', 'proxy']))
  })

  it('defaults low-level materialize and package CLIs to the official developer flavor', () => {
    const directory = temporaryDirectory()
    const materializedPath = join(directory, 'materialized')
    const archivePath = join(directory, 'developer.zip')
    const pluginRoot = resolve(import.meta.dirname, '..')

    execFileSync(process.execPath, [join(pluginRoot, 'bin/materialize-extension.cjs'), '--output', materializedPath])
    execFileSync(process.execPath, [join(pluginRoot, 'bin/package-extension.cjs'), '--output', archivePath])

    const manifest = JSON.parse(readFileSync(join(materializedPath, 'manifest.json'), 'utf8'))
    expect(manifest).toMatchObject({
      name: 'oneWorks External Browser',
      permissions: expect.arrayContaining(['debugger', 'proxy'])
    })
    expect(validator.validateExtensionArchive({ archivePath, flavor: 'privileged' }))
      .toMatchObject({ flavor: 'privileged' })
  })

  it('rejects an E2E or privileged manifest disguised as a base release', () => {
    const directory = temporaryDirectory()
    const archivePath = join(directory, 'base.zip')
    packager.packageExtension({ flavor: 'base', output: archivePath })
    const entries = unzipSync(new Uint8Array(readFileSync(archivePath)))
    const manifest = JSON.parse(Buffer.from(entries['manifest.json']).toString('utf8'))
    manifest.permissions.push('debugger')
    entries['manifest.json'] = Buffer.from(JSON.stringify(manifest))
    writeFileSync(archivePath, zipSync(entries))

    expect(() => validator.validateExtensionArchive({ archivePath, flavor: 'base' }))
      .toThrow(/audited base permissions policy/u)
  })

  it('rejects sensitive optional capabilities promoted to required base permissions', () => {
    const directory = temporaryDirectory()
    const archivePath = join(directory, 'base.zip')
    packager.packageExtension({ flavor: 'base', output: archivePath })
    const entries = unzipSync(new Uint8Array(readFileSync(archivePath)))
    const manifest = JSON.parse(Buffer.from(entries['manifest.json']).toString('utf8'))
    manifest.permissions.push('cookies')
    manifest.optional_permissions = manifest.optional_permissions.filter((value: string) => value !== 'cookies')
    entries['manifest.json'] = Buffer.from(JSON.stringify(manifest))
    writeFileSync(archivePath, zipSync(entries))

    expect(() => validator.validateExtensionArchive({ archivePath, flavor: 'base' }))
      .toThrow(/audited base permissions policy/u)
  })

  it('rejects a broad content-script match promoted into a release package', () => {
    const directory = temporaryDirectory()
    const archivePath = join(directory, 'base.zip')
    packager.packageExtension({ flavor: 'base', output: archivePath })
    const entries = unzipSync(new Uint8Array(readFileSync(archivePath)))
    const manifest = JSON.parse(Buffer.from(entries['manifest.json']).toString('utf8'))
    manifest.content_scripts[0].matches.push('*://*/*')
    entries['manifest.json'] = Buffer.from(JSON.stringify(manifest))
    writeFileSync(archivePath, zipSync(entries))

    expect(() => validator.validateExtensionArchive({ archivePath, flavor: 'base' }))
      .toThrow(/audited base content script matches policy/u)
  })

  it('rejects a release package with a different extension identity', () => {
    const directory = temporaryDirectory()
    const archivePath = join(directory, 'base.zip')
    packager.packageExtension({ flavor: 'base', output: archivePath })
    const entries = unzipSync(new Uint8Array(readFileSync(archivePath)))
    const manifest = JSON.parse(Buffer.from(entries['manifest.json']).toString('utf8'))
    manifest.key = Buffer.from('different-extension-key').toString('base64')
    entries['manifest.json'] = Buffer.from(JSON.stringify(manifest))
    writeFileSync(archivePath, zipSync(entries))

    expect(() => validator.validateExtensionArchive({ archivePath, flavor: 'base' }))
      .toThrow(/stable extension identity/u)
  })

  it('rejects a non-canonical Base64 public key before deriving an identity', () => {
    const directory = temporaryDirectory()
    const archivePath = join(directory, 'base.zip')
    packager.packageExtension({ flavor: 'base', output: archivePath })
    const entries = unzipSync(new Uint8Array(readFileSync(archivePath)))
    const manifest = JSON.parse(Buffer.from(entries['manifest.json']).toString('utf8'))
    manifest.key += '!!!!'
    entries['manifest.json'] = Buffer.from(JSON.stringify(manifest))
    writeFileSync(archivePath, zipSync(entries))

    expect(() => validator.validateExtensionArchive({ archivePath, flavor: 'base' }))
      .toThrow(/canonical Base64/u)
  })
})

describe('chrome Web Store V2 publishing', () => {
  it('keeps the full developer package environment-gated, automatically dispatched, and free of long-lived OAuth secrets', () => {
    const repositoryRoot = resolve(import.meta.dirname, '../../../..')
    const ciWorkflow = readFileSync(join(repositoryRoot, '.github/workflows/chrome-extension-ci.yml'), 'utf8')
    const workflow = readFileSync(join(repositoryRoot, '.github/workflows/chrome-extension-release.yml'), 'utf8')
    const releaseTags = readFileSync(join(repositoryRoot, '.github/workflows/release-tags.yml'), 'utf8')
    const publishCli = readFileSync(
      join(repositoryRoot, 'packages/plugins/chrome-driver/bin/publish-chrome-web-store.cjs'),
      'utf8'
    )

    expect(workflow).toContain("if: github.event_name == 'workflow_dispatch' && inputs.publish_store == true")
    expect(workflow).toContain('environment: chrome-web-store')
    expect(workflow).toContain('uses: google-github-actions/auth@v3')
    expect(workflow).toContain('artifact-metadata: write')
    expect(workflow).toMatch(/GH_REPO: \$\{\{ github\.repository \}\}/u)
    expect(workflow).toContain('access_token_scopes: https://www.googleapis.com/auth/chromewebstore')
    expect(workflow).toContain('needs.build.outputs.store_archive')
    expect(workflow).toContain('Upload and submit developer extension')
    expect(workflow).not.toContain('CHROME_WEB_STORE_REFRESH_TOKEN')
    expect(workflow).not.toContain('CHROME_WEB_STORE_CLIENT_SECRET')
    expect(publishCli).toContain('<developer-extension.zip>')
    expect(publishCli).not.toContain('<base-extension.zip>')
    expect(releaseTags).toContain('gh workflow run chrome-extension-release.yml')
    expect(releaseTags).toContain('-f publish_store="$publish_store"')
    expect(releaseTags.match(/dispatch_chrome_extension_release "\$tag" (?:true|false)/gu)).toEqual([
      'dispatch_chrome_extension_release "$tag" false',
      'dispatch_chrome_extension_release "$tag" true'
    ])
    expect(releaseTags).toMatch(
      /if git rev-parse[\s\S]*?pkg\/oneworks-plugin-chrome-driver\/v\*\)[\s\S]*?dispatch_chrome_extension_release "\$tag" false[\s\S]*?continue/u
    )
    expect(releaseTags).toMatch(
      /Creating \$tag[\s\S]*?pkg\/oneworks-plugin-chrome-driver\/v\*\)[\s\S]*?dispatch_chrome_extension_release "\$tag" true/u
    )
    expect(ciWorkflow.match(/- \.github\/workflows\/release-tags\.yml/gu)).toHaveLength(2)
  })

  it('uploads, polls asynchronous processing, and submits the validated developer archive', async () => {
    const directory = temporaryDirectory()
    const archivePath = join(directory, 'developer.zip')
    packager.packageExtension({ flavor: 'privileged', output: archivePath })
    const responses = [
      new Response(JSON.stringify({ uploadState: 'IN_PROGRESS' })),
      new Response(JSON.stringify({ lastAsyncUploadState: 'SUCCEEDED' })),
      new Response(JSON.stringify({ state: 'PENDING_REVIEW' }))
    ]
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      responses.shift() ?? new Response('', { status: 500 })
    )
    const sleep = vi.fn(async () => {})

    await expect(publisher.publishChromeWebStore({
      accessToken: 'short-lived-access-token',
      apiRoot: 'https://store.invalid',
      archivePath,
      extensionId: CHROME_EXTENSION_ID,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      pollIntervalMs: 0,
      publisherId: 'publisher-id',
      sleep
    })).resolves.toMatchObject({
      extension_id: CHROME_EXTENSION_ID,
      publish_state: 'PENDING_REVIEW',
      upload_state: 'SUCCEEDED'
    })
    expect(sleep).toHaveBeenCalledOnce()
    expect(fetchImpl.mock.calls.map(call => call[0])).toEqual([
      `https://store.invalid/upload/v2/publishers/publisher-id/items/${CHROME_EXTENSION_ID}:upload`,
      `https://store.invalid/v2/publishers/publisher-id/items/${CHROME_EXTENSION_ID}:fetchStatus`,
      `https://store.invalid/v2/publishers/publisher-id/items/${CHROME_EXTENSION_ID}:publish`
    ])
    expect(fetchImpl.mock.calls[2]?.[1]).toMatchObject({
      body: JSON.stringify({ blockOnWarnings: true, publishType: 'DEFAULT_PUBLISH', skipReview: false }),
      method: 'POST'
    })
  })

  it('does not submit a publication when upload processing fails', async () => {
    const directory = temporaryDirectory()
    const archivePath = join(directory, 'developer.zip')
    packager.packageExtension({ flavor: 'privileged', output: archivePath })
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ uploadState: 'FAILED' })))

    await expect(publisher.publishChromeWebStore({
      accessToken: 'short-lived-access-token',
      archivePath,
      extensionId: CHROME_EXTENSION_ID,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      publisherId: 'publisher-id'
    })).rejects.toThrow(/final state: FAILED/u)
    expect(fetchImpl).toHaveBeenCalledOnce()
  })

  it('rejects a Chrome Web Store item that does not match the packaged extension identity', async () => {
    const directory = temporaryDirectory()
    const archivePath = join(directory, 'developer.zip')
    packager.packageExtension({ flavor: 'privileged', output: archivePath })
    const fetchImpl = vi.fn()

    await expect(publisher.publishChromeWebStore({
      accessToken: 'short-lived-access-token',
      archivePath,
      extensionId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      publisherId: 'publisher-id'
    })).rejects.toThrow(/does not match packaged identity/u)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('rejects the minimal package before any Chrome Web Store request', async () => {
    const directory = temporaryDirectory()
    const archivePath = join(directory, 'minimal.zip')
    packager.packageExtension({ flavor: 'base', output: archivePath })
    const fetchImpl = vi.fn()

    await expect(publisher.publishChromeWebStore({
      accessToken: 'short-lived-access-token',
      archivePath,
      extensionId: CHROME_EXTENSION_ID,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      publisherId: 'publisher-id'
    })).rejects.toThrow(/privileged permissions/u)
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})
