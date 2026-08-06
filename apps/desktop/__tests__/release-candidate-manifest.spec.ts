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
  signed: false,
  sourceSha: 'a'.repeat(40),
  tag: 'pkg/oneworks-desktop/v0.1.0-beta.11',
  targets: 'dmg,zip,pkg'
})

const seedCandidateArtifacts = async (
  artifactDirectory: string,
  omit?: string
) => {
  const version = '0.1.0-beta.11'
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
