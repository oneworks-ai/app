import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const workflow = readFileSync('.github/workflows/desktop-package.yml', 'utf8')
const credentials = [
  'APPLE_ID',
  'APPLE_ID_PASSWORD',
  'APPLE_TEAM_ID',
  'DESKTOP_CSC_LINK',
  'DESKTOP_CSC_KEY_PASSWORD',
  'DESKTOP_CSC_INSTALLER_LINK',
  'DESKTOP_CSC_INSTALLER_KEY_PASSWORD'
] as const

function extractRunScript(stepName: string) {
  const stepMarker = `      - name: ${stepName}\n`
  const stepStart = workflow.indexOf(stepMarker)
  expect(stepStart).toBeGreaterThanOrEqual(0)

  const nextStep = workflow.indexOf('\n      - name:', stepStart + stepMarker.length)
  const step = workflow.slice(
    stepStart,
    nextStep === -1 ? workflow.length : nextStep
  )
  const runMarker = '\n        run: |\n'
  const runStart = step.indexOf(runMarker)
  expect(runStart).toBeGreaterThanOrEqual(0)

  return step
    .slice(runStart + runMarker.length)
    .split('\n')
    .map(line => line.startsWith('          ') ? line.slice(10) : line)
    .join('\n')
}

function runBash(script: string, env: NodeJS.ProcessEnv) {
  return spawnSync(
    'bash',
    ['--noprofile', '--norc', '-e', '-o', 'pipefail', '-c', script],
    {
      encoding: 'utf8',
      env: {
        PATH: process.env.PATH,
        ...env
      }
    }
  )
}

function runWithOutput(script: string, env: NodeJS.ProcessEnv) {
  const outputDir = mkdtempSync(path.join(tmpdir(), 'oneworks-desktop-workflow-'))
  const outputPath = path.join(outputDir, 'github-output')

  try {
    const result = runBash(script, {
      ...env,
      GITHUB_OUTPUT: outputPath
    })
    const output = result.status === 0 ? readFileSync(outputPath, 'utf8') : ''
    return { ...result, output }
  } finally {
    rmSync(outputDir, { force: true, recursive: true })
  }
}

describe('desktop package workflow', () => {
  it('keeps unsigned releases on the full artifact path', () => {
    const policy = runWithOutput(
      extractRunScript('Resolve desktop build policy'),
      { DESKTOP_SIGN_REQUESTED: 'false' }
    )
    const validation = runBash(
      extractRunScript('Validate desktop signing credentials'),
      { DESKTOP_SIGN: 'false' }
    )

    expect(policy.status).toBe(0)
    expect(policy.output).toContain('archs=arm64,x64')
    expect(policy.output).toContain('make_targets=dmg,zip,pkg')
    expect(policy.output).toContain('sign=false')
    expect(validation.status).toBe(0)
    expect(validation.stdout).toContain(
      'Desktop signing is disabled; release artifacts will be unsigned.'
    )

    const validationIndex = workflow.indexOf(
      '      - name: Validate desktop signing credentials'
    )
    const packageIndex = workflow.indexOf('      - name: Package desktop app')
    const buildIndex = workflow.indexOf('      - name: Build desktop artifacts')
    const verifyIndex = workflow.indexOf(
      '      - name: Verify macOS install artifact'
    )
    const uploadIndex = workflow.indexOf(
      '      - name: Upload installer artifacts'
    )

    expect(validationIndex).toBeLessThan(packageIndex)
    expect(packageIndex).toBeLessThan(buildIndex)
    expect(buildIndex).toBeLessThan(verifyIndex)
    expect(verifyIndex).toBeLessThan(uploadIndex)
  })

  it.each(credentials)(
    'fails signed releases when %s is missing',
    missingCredential => {
      const env = Object.fromEntries(
        credentials.map(name => [name, name === missingCredential ? '' : 'set'])
      )
      const result = runBash(
        extractRunScript('Validate desktop signing credentials'),
        {
          ...env,
          DESKTOP_SIGN: 'true'
        }
      )

      expect(result.status).toBe(1)
      expect(result.stderr).toContain(missingCredential)
    }
  )

  it('accepts signed releases only with the complete credential set', () => {
    const env = Object.fromEntries(credentials.map(name => [name, 'set']))
    const result = runBash(
      extractRunScript('Validate desktop signing credentials'),
      {
        ...env,
        DESKTOP_SIGN: 'true'
      }
    )

    expect(result.status).toBe(0)
  })

  it.each([
    [
      'false',
      '- Unsigned macOS installers; Gatekeeper may require manual approval'
    ],
    [
      'true',
      '- Developer ID signed and Apple-notarized macOS installers'
    ]
  ])('writes accurate release notes when signed=%s', (signed, expectedNote) => {
    const result = runWithOutput(
      extractRunScript('Resolve release notes'),
      {
        SIGNED: signed,
        TAG: 'pkg/oneworks-desktop/v0.1.0-beta.10'
      }
    )

    expect(result.status).toBe(0)
    expect(result.output).toContain(expectedNote)
    expect(result.output).toContain(
      '- Intel (x64) and Apple Silicon (arm64): .dmg, .pkg, .zip'
    )
  })
})
