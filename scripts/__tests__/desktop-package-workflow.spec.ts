import { spawnSync } from 'node:child_process'
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const workflow = readFileSync('.github/workflows/desktop-package.yml', 'utf8')
const homepageWorkflow = readFileSync(
  '.github/workflows/deploy-homepage.yml',
  'utf8'
)
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

function runReleaseTagGuard(status: number, output = '', sourceSha = 'a'.repeat(40)) {
  const commandDir = mkdtempSync(path.join(tmpdir(), 'oneworks-desktop-workflow-bin-'))
  const gitPath = path.join(commandDir, 'git')
  writeFileSync(
    gitPath,
    `#!/usr/bin/env bash\nprintf '%s' "$FAKE_GIT_OUTPUT"\nexit "$FAKE_GIT_STATUS"\n`
  )
  chmodSync(gitPath, 0o755)

  try {
    return runBash(
      extractRunScript('Verify release tag source'),
      {
        FAKE_GIT_OUTPUT: output,
        FAKE_GIT_STATUS: String(status),
        PATH: `${commandDir}:${process.env.PATH}`,
        SOURCE_SHA: sourceSha,
        TAG: 'pkg/oneworks-desktop/v0.1.0-beta.11'
      }
    )
  } finally {
    rmSync(commandDir, { force: true, recursive: true })
  }
}

describe('desktop package workflow', () => {
  it('runs unsigned pull request closure smoke while keeping installers release-only', () => {
    expect(workflow).toContain('schedule:\n    - cron: "0 18 * * *"')
    expect(workflow).toContain('pr-policy:\n    name: macOS installer')
    expect(workflow).toContain("github.event_name != 'pull_request'")

    const prJob = workflow.slice(
      workflow.indexOf('  pr-policy:'),
      workflow.indexOf('  dispatch-policy:')
    )
    expect(prJob).toContain('runs-on: macos-26')
    expect(prJob).toContain('ONEWORKS_DESKTOP_ARCHS: arm64,x64')
    expect(prJob).toContain(
      'node packages/fs-authority-native/scripts/verify-darwin-prebuilds.mjs "$authority_root"'
    )
    expect(prJob).toContain('ONEWORKS_DESKTOP_SMOKE_ARCH: arm64')
    expect(prJob).toContain('run: pnpm -C apps/desktop smoke:package')
    expect(prJob).not.toContain('desktop:make')
    expect(prJob).not.toContain('APPLE_')
    expect(prJob).not.toContain('Upload installer artifacts')

    const nightlyPolicy = runWithOutput(
      extractRunScript('Resolve desktop build policy'),
      {
        DESKTOP_SIGN_REQUESTED: 'true',
        EVENT_NAME: 'schedule'
      }
    )
    expect(nightlyPolicy.status).toBe(0)
    expect(nightlyPolicy.output).toContain('archs=arm64')
    expect(nightlyPolicy.output).toContain('make_targets=dmg')
    expect(nightlyPolicy.output).toContain('sign=false')
  })

  it('builds a release-identity candidate without publishing it', () => {
    const metadata = runWithOutput(
      extractRunScript('Resolve desktop release metadata'),
      {
        CREATE_RELEASE_REQUESTED: 'false',
        DESKTOP_AUTO_UPDATE_REQUESTED: 'true',
        DESKTOP_RELEASE_TAG_PREFIX: 'pkg/oneworks-desktop/v',
        EVENT_NAME: 'workflow_dispatch',
        GITHUB_REF: 'refs/heads/main',
        GITHUB_REF_NAME: 'main',
        RELEASE_TAG_INPUT: 'pkg/oneworks-desktop/v0.1.0-beta.11'
      }
    )

    expect(metadata.status).toBe(0)
    expect(metadata.output).toContain('enabled=true')
    expect(metadata.output).toContain('auto_update=true')
    expect(metadata.output).toContain('tag=pkg/oneworks-desktop/v0.1.0-beta.11')
    expect(metadata.output).toContain('update_channel=beta')
    expect(metadata.output).toContain('version=0.1.0-beta.11')
  })

  it('rejects a manual release before packaging when its tag is missing', () => {
    const metadata = runWithOutput(
      extractRunScript('Resolve desktop release metadata'),
      {
        CREATE_RELEASE_REQUESTED: 'true',
        DESKTOP_AUTO_UPDATE_REQUESTED: 'true',
        DESKTOP_RELEASE_TAG_PREFIX: 'pkg/oneworks-desktop/v',
        EVENT_NAME: 'workflow_dispatch',
        GITHUB_REF: 'refs/heads/main',
        GITHUB_REF_NAME: 'main',
        RELEASE_TAG_INPUT: ''
      }
    )

    expect(metadata.status).toBe(1)
    expect(metadata.stderr).toContain(
      'release_tag is required when create_release is enabled manually.'
    )
  })

  it('can promote a verified candidate run without rebuilding', () => {
    const invalidCandidate = runBash(
      extractRunScript('Validate desktop workflow request'),
      {
        CANDIDATE_RUN_ID: 'not-a-run',
        CREATE_RELEASE_REQUESTED: 'true',
        RELEASE_TAG_INPUT: 'pkg/oneworks-desktop/v0.1.0-beta.11'
      }
    )

    expect(invalidCandidate.status).toBe(1)
    expect(invalidCandidate.stderr).toContain(
      'candidate_run_id must be a numeric GitHub Actions run id.'
    )
    expect(workflow).toContain('candidate_run_id:')
    expect(workflow).toContain("inputs.candidate_run_id != ''")
    expect(workflow).toContain(
      `run-id: \${{ github.event_name == 'workflow_dispatch' && inputs.candidate_run_id || github.run_id }}`
    )
    expect(workflow).toContain(
      'node apps/desktop/scripts/release-candidate-manifest.cjs verify release-artifacts'
    )
    expect(workflow).toContain('actions: read\n      contents: write')
    expect(workflow).toContain(
      `SOURCE_SHA: \${{ steps.candidate.outputs.source_sha }}`
    )
    expect(workflow).toContain(
      'Release tag $TAG points to $resolved_source_sha, not verified candidate $SOURCE_SHA.'
    )
  })

  it('publishes the homepage only after the GitHub Release succeeds', () => {
    expect(workflow).toContain('homepage:\n    name: Publish Homepage')
    expect(workflow).toContain("if: needs.release.result == 'success'")
    expect(workflow).toContain('uses: ./.github/workflows/deploy-homepage.yml')
    expect(workflow).toContain(
      `source_sha: \${{ needs.release.outputs.source_sha }}`
    )
    expect(workflow).not.toContain('secrets: inherit')
    expect(workflow).toContain(
      `HOMEPAGE_DEPLOY_TOKEN: \${{ secrets.HOMEPAGE_DEPLOY_TOKEN }}`
    )
    expect(homepageWorkflow).toContain(
      'secrets:\n      HOMEPAGE_DEPLOY_TOKEN:'
    )
  })

  it('fails closed when the release tag source cannot be verified', () => {
    const tag = 'pkg/oneworks-desktop/v0.1.0-beta.11'
    const sourceSha = 'a'.repeat(40)
    const matched = runReleaseTagGuard(
      0,
      `${sourceSha}\trefs/tags/${tag}\n`,
      sourceSha
    )
    const matchedAnnotated = runReleaseTagGuard(
      0,
      `${'c'.repeat(40)}\trefs/tags/${tag}\n${sourceSha}\trefs/tags/${tag}^{}\n`,
      sourceSha
    )
    const mismatched = runReleaseTagGuard(
      0,
      `${'b'.repeat(40)}\trefs/tags/${tag}\n`,
      sourceSha
    )
    const absent = runReleaseTagGuard(2, '', sourceSha)
    const unavailable = runReleaseTagGuard(128, '', sourceSha)

    expect(matched.status, matched.stderr).toBe(0)
    expect(matchedAnnotated.status, matchedAnnotated.stderr).toBe(0)
    expect(mismatched.status).toBe(1)
    expect(mismatched.stderr).toContain('not verified candidate')
    expect(absent.status).toBe(0)
    expect(absent.stdout).toContain('does not exist yet')
    expect(unavailable.status).toBe(1)
    expect(unavailable.stderr).toContain('Unable to query release tag')
  })

  it('keeps unsigned releases on the full artifact path', () => {
    const policy = runWithOutput(
      extractRunScript('Resolve desktop build policy'),
      {
        DESKTOP_SIGN_REQUESTED: 'false',
        EVENT_NAME: 'workflow_dispatch'
      }
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
