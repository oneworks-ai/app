import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { describe, expect, it, vi } from 'vitest'

import {
  evaluateNpmPublishMode,
  executeFrozenPublish,
  freezeApprovedTarballs,
  npmOidcAudience,
  preparePublishWorkspaceDependencies,
  proveOidcExchangesBeforePublish,
  redactNpmPublishSecrets,
  verifyNpmPublishPostflight,
  verifySlsaProvenance
} from '../npm-publish-guard.mjs'

const item = { name: '@oneworks/new', version: '1.0.0-rc.3' }
const bytes = Buffer.from('approved tarball')
const approved = new Map([[item.name, {
  version: item.version,
  integrity: `sha512-${createHash('sha512').update(bytes).digest('base64')}`,
  sha512: createHash('sha512').update(bytes).digest('hex'),
  shasum: createHash('sha1').update(bytes).digest('hex')
}]])
const expected = {
  githubRepository: 'oneworks-ai/app',
  githubWorkflowPath: '.github/workflows/npm-publish-alpha.yml',
  githubRef: 'refs/heads/main',
  githubSha: 'a'.repeat(40),
  githubRunId: '123',
  githubRunAttempt: '2'
}
const provenanceStatement = () => ({
  _type: 'https://in-toto.io/Statement/v1',
  subject: [{ name: 'pkg:npm/%40oneworks/new@1.0.0-rc.3', digest: { sha512: approved.get(item.name)?.sha512 } }],
  predicateType: 'https://slsa.dev/provenance/v1',
  predicate: {
    buildDefinition: {
      externalParameters: {
        workflow: {
          repository: 'https://github.com/oneworks-ai/app',
          path: '.github/workflows/npm-publish-alpha.yml',
          ref: 'refs/heads/main'
        }
      },
      resolvedDependencies: [{
        uri: 'git+https://github.com/oneworks-ai/app@refs/heads/main',
        digest: { gitCommit: 'a'.repeat(40) }
      }]
    },
    runDetails: { metadata: { invocationId: 'https://github.com/oneworks-ai/app/actions/runs/123/attempts/2' } }
  }
})
const provenance = (extra = {}) => ({
  attestations: [{
    predicateType: 'https://slsa.dev/provenance/v1',
    bundle: { dsseEnvelope: { payload: Buffer.from(JSON.stringify(provenanceStatement())).toString('base64') } }
  }],
  ...extra
})

describe('npm publish guard', () => {
  it('builds each selected source dependency closure before local packing', () => {
    const runCommand = vi.fn(() => ({ status: 0 }))
    const planItem = (name: string, publishAliasFor: string | null = null) => ({
      name,
      dir: `/repo/${name}`,
      version: '1.0.0-rc.3',
      nextVersion: '1.0.0-rc.3',
      private: false,
      publishAliasFor,
      internalDependencies: [],
      impactedDependents: []
    })
    const source = planItem('@oneworks/source')
    const alias = planItem('source-alias', source.name)
    const modelProtocol = planItem('@oneworks/model-protocol')
    expect(preparePublishWorkspaceDependencies({
      items: [source, alias, modelProtocol],
      repoRoot: '/repo',
      runCommand
    })).toEqual({ sourceNames: [source.name, modelProtocol.name] })
    expect(runCommand).toHaveBeenCalledWith('pnpm', [
      '--filter',
      '@oneworks/source^...',
      '--filter',
      '@oneworks/model-protocol^...',
      '--workspace-concurrency=1',
      '--if-present',
      'run',
      'build'
    ], { cwd: '/repo', stdio: 'pipe' })
    expect(() =>
      preparePublishWorkspaceDependencies({
        items: [modelProtocol],
        runCommand: () => ({ status: 1 })
      })
    ).toThrow('dependency build failed before local packing')
  })

  it('orders proof/recheck before publish, removes boolean auth, and always reconciles', async () => {
    const workflow = await readFile(`${process.cwd()}/.github/workflows/npm-publish-alpha.yml`, 'utf8')
    expect(workflow).toContain('auth_mode:')
    expect(workflow).not.toContain('bootstrap_with_token')
    expect(workflow.indexOf('Prove publish authentication before the first publish')).toBeLessThan(
      workflow.indexOf('node ./scripts/npm-publish-guard.mjs publish')
    )
    expect(workflow.indexOf('Recheck targets before publish')).toBeLessThan(
      workflow.indexOf('node ./scripts/npm-publish-guard.mjs publish')
    )
    expect(workflow).not.toContain('--skip-existing')
    expect(workflow).toContain('if: ' + '$' + '{{ always() && !inputs.dry_run }}')
  })
  it('rejects unsafe bootstrap and oidc token fallback', () => {
    expect(evaluateNpmPublishMode({
      mode: 'new-identity-bootstrap',
      requestedNames: [],
      publishAll: true,
      publishTag: 'rc.4',
      tokenAvailable: false,
      targetProvenanceRequired: true,
      onboardingVersion: '1.0.0-rc.3',
      selectedItems: [{ ...item, version: '1.0.0-rc.4' }],
      registryMetadata: new Map([[item.name, {}]])
    })).toEqual(
      expect.arrayContaining([
        'new-identity-bootstrap requires publish_tag=onboarding.',
        'new-identity-bootstrap must publish one exact selected-manifest onboarding version.',
        'new-identity-bootstrap cannot mix existing identities: @oneworks/new'
      ])
    )
    expect(
      evaluateNpmPublishMode({
        mode: 'oidc',
        requestedNames: [item.name],
        publishAll: false,
        publishTag: 'rc',
        tokenAvailable: true,
        targetProvenanceRequired: true,
        onboardingVersion: item.version,
        selectedItems: [item],
        registryMetadata: new Map([[item.name, null]])
      })
    ).toEqual(
      expect.arrayContaining([
        'oidc mode forbids NPM_TOKEN authentication.',
        'oidc mode requires every selected identity to exist: @oneworks/new'
      ])
    )
  })
  it('exchanges every identity without exposing exchange tokens', async () => {
    const fetchImpl = vi.fn(async (url: URL | string) =>
      String(url).startsWith('https://actions.example')
        ? new Response(JSON.stringify({ value: 'gha-id-token' }))
        : new Response(JSON.stringify({ token: 'package-token' }), { status: 201 })
    )
    await expect(
      proveOidcExchangesBeforePublish({
        selectedItems: [item, { ...item, name: 'onework' }],
        requestToken: 'request-token',
        requestUrl: 'https://actions.example/token',
        fetchImpl
      })
    ).resolves.toEqual({ exchangedIdentityCount: 2 })
    expect(String(fetchImpl.mock.calls[0]?.[0])).toContain(`audience=${encodeURIComponent(npmOidcAudience)}`)
    expect(redactNpmPublishSecrets('package-token', ['package-token'])).toBe('[REDACTED]')
  })
  it('parses only one structural SLSA DSSE record', () => {
    expect(
      verifySlsaProvenance({
        attestationDocument: provenance(),
        name: item.name,
        version: item.version,
        sha512: approved.get(item.name)?.sha512,
        ...expected
      })
    ).toMatchObject({ predicateType: 'https://slsa.dev/provenance/v1' })
    expect(() =>
      verifySlsaProvenance({
        attestationDocument: provenance({ attestations: [provenance().attestations[0], provenance().attestations[0]] }),
        name: item.name,
        version: item.version,
        sha512: approved.get(item.name)?.sha512,
        ...expected
      })
    ).toThrow('exactly one')
    expect(() =>
      verifySlsaProvenance({
        attestationDocument: provenance(),
        name: item.name,
        version: item.version,
        sha512: 'f'.repeat(128),
        ...expected
      })
    ).toThrow('subject')
  })
  it('allows bootstrap latest null to target only and compares frozen bytes', async () => {
    const dist = {
      integrity: approved.get(item.name)?.integrity,
      shasum: approved.get(item.name)?.shasum,
      tarball: 'https://registry.example/pkg.tgz'
    }
    const fetchImpl = vi.fn(async (url: string) =>
      url.includes('registry.npmjs.org')
        ? new Response(
          JSON.stringify({
            'dist-tags': { onboarding: item.version, latest: item.version },
            versions: { [item.version]: { dist } }
          })
        )
        : new Response(bytes)
    )
    await expect(
      verifyNpmPublishPostflight({
        mode: 'new-identity-bootstrap',
        items: [item],
        publishTag: 'onboarding',
        latestBefore: new Map([[item.name, null]]),
        approvedTarballs: approved,
        fetchImpl
      })
    ).resolves.toMatchObject({ complete: true })
    await expect(
      verifyNpmPublishPostflight({
        mode: 'oidc',
        items: [item],
        publishTag: 'onboarding',
        latestBefore: new Map([[item.name, null]]),
        approvedTarballs: approved,
        fetchImpl,
        ...expected
      })
    ).resolves.toMatchObject({ complete: false })
  })

  it('freezes local pnpm-pack bytes for a source package and its alias with absolute filenames', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'npm-publish-guard-pack-'))
    const source = { name: 'source-package', version: '1.0.0', dir: directory, publishAliasFor: null }
    const alias = { ...source, name: 'alias-package', publishAliasFor: 'source-package' }
    try {
      await writeFile(
        path.join(directory, 'package.json'),
        JSON.stringify({
          name: source.name,
          version: source.version,
          bin: { 'source-package': './cli.js' }
        })
      )
      await writeFile(path.join(directory, 'cli.js'), 'console.log("ok")\n')
      const frozen = await freezeApprovedTarballs({ items: [source, alias] })
      expect(frozen.get(source.name)?.sha512).toHaveLength(128)
      expect(frozen.get(alias.name)?.sha512).toHaveLength(128)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('publishes the exact frozen source and alias tarballs in plan order without a directory repack', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'npm-publish-guard-publish-'))
    const source = { name: 'source-package', version: '1.0.0', dir: directory, publishAliasFor: null }
    const alias = { ...source, name: 'alias-package', publishAliasFor: 'source-package' }
    const sourcePath = path.join(directory, 'source.tgz')
    const aliasPath = path.join(directory, 'alias.tgz')
    const digest = (content: Buffer, filePath: string) => ({
      filePath,
      version: '1.0.0',
      integrity: `sha512-${createHash('sha512').update(content).digest('base64')}`,
      sha512: createHash('sha512').update(content).digest('hex'),
      shasum: createHash('sha1').update(content).digest('hex')
    })
    const sourceBytes = Buffer.from('source exact bytes')
    const aliasBytes = Buffer.from('alias exact bytes')
    const calls: string[][] = []
    try {
      await writeFile(sourcePath, sourceBytes)
      await writeFile(aliasPath, aliasBytes)
      await expect(executeFrozenPublish({
        items: [source, alias],
        approvedTarballs: new Map([[source.name, digest(sourceBytes, sourcePath)], [
          alias.name,
          digest(aliasBytes, aliasPath)
        ]]),
        publishTag: 'rc',
        dryRun: true,
        preflightMetadata: new Map([[source.name, { versions: {} }], [alias.name, { versions: {} }]]),
        fetchImpl: async () => new Response(null, { status: 404 }),
        runCommand: (_command: string, args: string[]) => {
          calls.push(args)
          return { status: 0, stdout: '', stderr: '' }
        }
      })).resolves.toEqual({ attempts: [{ name: source.name, status: 0 }, { name: alias.name, status: 0 }] })
      expect(calls.map(args => args[1])).toEqual([sourcePath, aliasPath])
      expect(calls.flat()).not.toContain(directory)
      expect(calls.flat()).not.toContain('--skip-existing')
      expect(calls.every(args => args.includes('--dry-run'))).toBe(true)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('stops before the first frozen publish when a target version collides', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'npm-publish-guard-collision-'))
    const tarball = path.join(directory, 'package.tgz')
    const content = Buffer.from('frozen')
    const runCommand = vi.fn(() => ({ status: 0, stdout: '', stderr: '' }))
    try {
      await writeFile(tarball, content)
      await expect(executeFrozenPublish({
        items: [{ ...item, dir: directory }],
        approvedTarballs: new Map([[item.name, {
          filePath: tarball,
          version: item.version,
          integrity: `sha512-${createHash('sha512').update(content).digest('base64')}`,
          sha512: createHash('sha512').update(content).digest('hex'),
          shasum: createHash('sha1').update(content).digest('hex')
        }]]),
        publishTag: 'rc',
        preflightMetadata: new Map([[item.name, { versions: {} }]]),
        fetchImpl: async () => new Response(JSON.stringify({ versions: { [item.version]: {} } })),
        runCommand
      })).rejects.toThrow('appeared after preflight')
      expect(runCommand).not.toHaveBeenCalled()
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('rejects a mixed initial snapshot before publishing any earlier missing identity', async () => {
    const runCommand = vi.fn(() => ({ status: 0, stdout: '', stderr: '' }))
    await expect(executeFrozenPublish({
      items: [{ name: 'missing-first', version: '1.0.0' }, { name: 'already-present', version: '1.0.0' }],
      approvedTarballs: new Map(),
      publishTag: 'rc',
      preflightMetadata: new Map([
        ['missing-first', { versions: {} }],
        ['already-present', { versions: { '1.0.0': {} } }]
      ]),
      fetchImpl: async () => new Response(null, { status: 404 }),
      runCommand
    })).rejects.toThrow('already existed in the initial preflight snapshot')
    expect(runCommand).not.toHaveBeenCalled()
  })
})
