import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const {
  MANIFEST_FILE_NAME,
  createCandidateManifest,
  verifyCandidateManifest
} = require('../scripts/release-candidate-manifest.cjs') as typeof import('../scripts/release-candidate-manifest.cjs')

const candidateInput = (artifactDirectory: string) => ({
  adHocSealed: true,
  architectures: 'arm64,x64',
  artifactDirectory,
  builderSha: 'b'.repeat(40),
  createdAt: '2026-07-30T00:00:00Z',
  effectiveSigningPolicy: 'unsigned',
  immutableSigningPolicy: 'auto',
  requestedSigningPolicy: 'auto',
  signed: false,
  sourceSha: 'a'.repeat(40),
  tag: 'pkg/oneworks-desktop/v0.1.0-beta.11',
  targets: 'dmg,zip,pkg'
})

const seedCandidateArtifacts = async (
  artifactDirectory: string,
  omit?: string,
  version = '0.1.0-beta.11'
) => {
  const names = ['arm64', 'x64'].flatMap(architecture =>
    ['dmg', 'zip', 'pkg'].map(target => `oneworks-${version}-mac-${architecture}.${target}`)
  )
  await Promise.all(
    names
      .filter(name => name !== omit)
      .map(name => writeFile(path.join(artifactDirectory, name), name))
  )
  await writeFile(path.join(artifactDirectory, 'beta-mac.yml'), 'update metadata')
}

describe('desktop release candidate manifest', () => {
  it('records source identity and deterministic artifact digests', async () => {
    const artifactDirectory = await mkdtemp(path.join(tmpdir(), 'oneworks-desktop-candidate-'))
    await seedCandidateArtifacts(artifactDirectory)

    const created = createCandidateManifest(candidateInput(artifactDirectory))
    const stored = JSON.parse(
      await readFile(path.join(artifactDirectory, MANIFEST_FILE_NAME), 'utf8')
    )
    const verified = verifyCandidateManifest({
      artifactDirectory,
      expectedTag: candidateInput(artifactDirectory).tag
    })

    expect(created).toMatchObject({
      adHocSealed: true,
      architectures: ['arm64', 'x64'],
      builderSha: 'b'.repeat(40),
      effectiveSigningPolicy: 'unsigned',
      immutableSigningPolicy: 'auto',
      signed: false,
      sourceSha: 'a'.repeat(40),
      targets: ['dmg', 'zip', 'pkg'],
      updateChannel: 'beta',
      version: '0.1.0-beta.11'
    })
    expect(stored.artifacts).toHaveLength(7)
    expect(stored.artifacts[0].sha256).toMatch(/^[0-9a-f]{64}$/)
    expect(verified).toEqual(stored)
  })

  it('rejects promotion when an artifact changed after verification', async () => {
    const artifactDirectory = await mkdtemp(path.join(tmpdir(), 'oneworks-desktop-candidate-'))
    const artifactPath = path.join(
      artifactDirectory,
      'oneworks-0.1.0-beta.11-mac-arm64.dmg'
    )
    await seedCandidateArtifacts(artifactDirectory)
    createCandidateManifest(candidateInput(artifactDirectory))
    await writeFile(artifactPath, 'mutated')

    expect(() =>
      verifyCandidateManifest({
        artifactDirectory,
        expectedTag: candidateInput(artifactDirectory).tag
      })
    ).toThrow('artifact inventory or SHA-256 digest does not match')
  })

  it('rejects promotion under a different release tag', async () => {
    const artifactDirectory = await mkdtemp(path.join(tmpdir(), 'oneworks-desktop-candidate-'))
    await seedCandidateArtifacts(artifactDirectory)
    createCandidateManifest(candidateInput(artifactDirectory))

    expect(() =>
      verifyCandidateManifest({
        artifactDirectory,
        expectedTag: 'pkg/oneworks-desktop/v0.1.0-beta.12'
      })
    ).toThrow('tag mismatch')
  })

  it('rejects candidates without exactly one complete signing mode', async () => {
    const artifactDirectory = await mkdtemp(path.join(tmpdir(), 'oneworks-desktop-candidate-'))
    await seedCandidateArtifacts(artifactDirectory)

    expect(() =>
      createCandidateManifest({
        ...candidateInput(artifactDirectory),
        adHocSealed: false
      })
    ).toThrow('either Developer ID signed or ad-hoc sealed')
    expect(() =>
      createCandidateManifest({
        ...candidateInput(artifactDirectory),
        signed: true
      })
    ).toThrow('either Developer ID signed or ad-hoc sealed')
  })

  it('binds candidate promotion to the effective signing policy', async () => {
    const artifactDirectory = await mkdtemp(path.join(tmpdir(), 'oneworks-desktop-candidate-'))
    await seedCandidateArtifacts(artifactDirectory)
    createCandidateManifest(candidateInput(artifactDirectory))

    expect(() =>
      verifyCandidateManifest({
        artifactDirectory,
        expectedSigningPolicy: 'signed',
        expectedTag: candidateInput(artifactDirectory).tag
      })
    ).toThrow('does not match the promotion request')
    expect(
      verifyCandidateManifest({
        artifactDirectory,
        expectedSigningPolicy: 'auto',
        expectedTag: candidateInput(artifactDirectory).tag
      }).effectiveSigningPolicy
    ).toBe('unsigned')
  })

  it('rejects creation when a manual candidate drifted from immutable policy metadata', async () => {
    const artifactDirectory = await mkdtemp(path.join(tmpdir(), 'oneworks-desktop-candidate-'))
    const version = '0.1.0-rc.3'
    await seedCandidateArtifacts(artifactDirectory, undefined, version)
    expect(() =>
      createCandidateManifest({
        ...candidateInput(artifactDirectory),
        immutableSigningPolicy: 'auto',
        requestedSigningPolicy: 'unsigned',
        tag: `pkg/oneworks-desktop/v${version}`
      })
    ).toThrow('drifted from immutable metadata')
  })

  it('fails closed when legacy candidate schemas cannot prove immutable policy', async () => {
    const artifactDirectory = await mkdtemp(path.join(tmpdir(), 'oneworks-desktop-candidate-'))
    await seedCandidateArtifacts(artifactDirectory)
    createCandidateManifest(candidateInput(artifactDirectory))
    const manifestPath = path.join(artifactDirectory, MANIFEST_FILE_NAME)
    const stored = JSON.parse(await readFile(manifestPath, 'utf8'))
    stored.schemaVersion = 2
    delete stored.effectiveSigningPolicy
    delete stored.immutableSigningPolicy
    delete stored.requestedSigningPolicy
    await writeFile(manifestPath, `${JSON.stringify(stored, null, 2)}\n`)

    expect(() =>
      verifyCandidateManifest({
        artifactDirectory,
        enforceImmutableSigningPolicy: true,
        expectedTag: candidateInput(artifactDirectory).tag
      })
    ).toThrow('does not record immutable signing policy')
  })

  it('fails closed for unsigned stable candidates', async () => {
    const artifactDirectory = await mkdtemp(path.join(tmpdir(), 'oneworks-desktop-candidate-'))
    await seedCandidateArtifacts(artifactDirectory)

    expect(() =>
      createCandidateManifest({
        ...candidateInput(artifactDirectory),
        tag: 'pkg/oneworks-desktop/v0.1.0'
      })
    ).toThrow('Stable Desktop release candidates must be Developer ID signed')
  })

  it('rejects a candidate when any requested installer is missing', async () => {
    const artifactDirectory = await mkdtemp(path.join(tmpdir(), 'oneworks-desktop-candidate-'))
    await seedCandidateArtifacts(
      artifactDirectory,
      'oneworks-0.1.0-beta.11-mac-x64.pkg'
    )

    expect(() => createCandidateManifest(candidateInput(artifactDirectory))).toThrow('installer matrix mismatch')
  })

  it('rejects unsupported architectures and a partial promotion policy', async () => {
    const artifactDirectory = await mkdtemp(path.join(tmpdir(), 'oneworks-desktop-candidate-'))
    await seedCandidateArtifacts(artifactDirectory)

    expect(() =>
      createCandidateManifest({
        ...candidateInput(artifactDirectory),
        architectures: 'arm64,ppc'
      })
    ).toThrow('Unsupported architectures: ppc')

    createCandidateManifest(candidateInput(artifactDirectory))
    expect(() =>
      verifyCandidateManifest({
        artifactDirectory,
        expectedArchitectures: 'arm64',
        expectedTag: candidateInput(artifactDirectory).tag,
        expectedTargets: 'dmg,zip,pkg'
      })
    ).toThrow('architectures do not match the promotion policy')
  })
})
