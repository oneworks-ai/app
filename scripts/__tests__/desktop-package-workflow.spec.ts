/* eslint-disable max-lines -- one workflow contract is intentionally exercised end to end. */
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
  const nextJobOffset = workflow
    .slice(stepStart + stepMarker.length)
    .search(/\n {2}[\w-]+:\n/iu)
  const nextJob = nextJobOffset === -1
    ? -1
    : stepStart + stepMarker.length + nextJobOffset
  const boundaries = [nextStep, nextJob].filter(boundary => boundary !== -1)
  const stepEnd = boundaries.length === 0 ? workflow.length : Math.min(...boundaries)
  const step = workflow.slice(
    stepStart,
    stepEnd
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

function runProductSourceGuard({
  builderSourceSha = 'c'.repeat(40),
  eventName = 'workflow_dispatch',
  output,
  productSourceSha = 'a'.repeat(40),
  status = 0,
  workflowRef = 'refs/heads/main',
  workflowSha = 'c'.repeat(40)
}: {
  builderSourceSha?: string
  eventName?: string
  output: string
  productSourceSha?: string
  status?: number
  workflowRef?: string
  workflowSha?: string
}) {
  const commandDir = mkdtempSync(path.join(tmpdir(), 'oneworks-desktop-product-source-bin-'))
  const gitPath = path.join(commandDir, 'git')
  writeFileSync(
    gitPath,
    `#!/usr/bin/env bash\nprintf '%s' "$FAKE_GIT_OUTPUT"\nexit "$FAKE_GIT_STATUS"\n`
  )
  chmodSync(gitPath, 0o755)

  try {
    return runBash(
      extractRunScript('Validate requested product source'),
      {
        BUILDER_SOURCE_SHA: builderSourceSha,
        DESKTOP_RELEASE_TAG_PREFIX: 'pkg/oneworks-desktop/v',
        EVENT_NAME: eventName,
        FAKE_GIT_OUTPUT: output,
        FAKE_GIT_STATUS: String(status),
        PATH: `${commandDir}:${process.env.PATH}`,
        PRODUCT_SOURCE_SHA: productSourceSha,
        RELEASE_TAG_INPUT: 'pkg/oneworks-desktop/v0.1.0',
        WORKFLOW_REF: workflowRef,
        WORKFLOW_SHA: workflowSha
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
    expect(workflow).toContain('builder_source_sha:')
    expect(workflow).toContain('product_source_sha:')
    expect(workflow).toContain('replace_existing_release:')
    expect(workflow).toContain('product_source_sha cannot be combined with candidate_run_id.')
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

  it('requires explicit product and builder identities for existing release replacement', () => {
    const script = extractRunScript('Validate desktop workflow request')
    const baseEnv = {
      BUILDER_SOURCE_SHA: 'b'.repeat(40),
      CANDIDATE_RUN_ID: '',
      CREATE_RELEASE_REQUESTED: 'true',
      PRODUCT_SOURCE_SHA: 'a'.repeat(40),
      RELEASE_TAG_INPUT: 'pkg/oneworks-desktop/v0.1.0',
      REPLACE_EXISTING_RELEASE: 'true'
    }

    const validReplacement = runBash(script, baseEnv)
    expect(validReplacement.status, validReplacement.stderr).toBe(0)
    const missingBuilder = runBash(script, { ...baseEnv, BUILDER_SOURCE_SHA: '' })
    expect(missingBuilder.status).toBe(1)
    expect(missingBuilder.stderr).toContain('builder_source_sha must be a full')
    const missingProduct = runBash(script, {
      ...baseEnv,
      BUILDER_SOURCE_SHA: '',
      PRODUCT_SOURCE_SHA: ''
    })
    expect(missingProduct.status).toBe(1)
    expect(missingProduct.stderr).toContain('requires create_release=true and product_source_sha')
  })

  it('rebuilds only an immutable product source matching the peeled release tag', () => {
    const tag = 'pkg/oneworks-desktop/v0.1.0'
    const sourceSha = 'a'.repeat(40)
    const matched = runProductSourceGuard({
      output: `${'b'.repeat(40)}\trefs/tags/${tag}\n${sourceSha}\trefs/tags/${tag}^{}\n`,
      productSourceSha: sourceSha
    })
    const mismatched = runProductSourceGuard({
      output: `${'b'.repeat(40)}\trefs/tags/${tag}\n`
    })
    const wrongEvent = runProductSourceGuard({
      eventName: 'push',
      output: ''
    })
    const wrongBuilder = runProductSourceGuard({
      builderSourceSha: 'd'.repeat(40),
      output: `${'b'.repeat(40)}\trefs/tags/${tag}\n${sourceSha}\trefs/tags/${tag}^{}\n`
    })
    const wrongRef = runProductSourceGuard({
      output: `${'b'.repeat(40)}\trefs/tags/${tag}\n${sourceSha}\trefs/tags/${tag}^{}\n`,
      workflowRef: 'refs/heads/codex/unsafe-builder'
    })

    expect(matched.status, matched.stderr).toBe(0)
    expect(mismatched.status).toBe(1)
    expect(mismatched.stderr).toContain('not requested product source')
    expect(wrongEvent.status).toBe(1)
    expect(wrongEvent.stderr).toContain('only supported for manual workflow dispatch')
    expect(wrongBuilder.status).toBe(1)
    expect(wrongBuilder.stderr).toContain('does not match workflow commit')
    expect(wrongRef.status).toBe(1)
    expect(wrongRef.stderr).toContain('protected refs/heads/main')
    expect(workflow).toContain('path: product-source')
    expect(workflow).toContain('ref: $' + '{{ inputs.product_source_sha }}')
    expect(workflow).toContain(
      'working-directory: $' + '{{ steps.desktop_workspace.outputs.workspace_dir }}'
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
    const verifyArtifactsIndex = workflow.indexOf(
      '      - name: Verify every unsigned macOS artifact seal'
    )
    const uploadIndex = workflow.indexOf(
      '      - name: Upload installer artifacts'
    )
    const sealIndex = workflow.indexOf(
      '      - name: Seal immutable unsigned product app bundles'
    )
    const verifyQuarantineIndex = workflow.indexOf(
      '      - name: Verify unsigned installed app quarantine boundary'
    )
    expect(validationIndex).toBeLessThan(packageIndex)
    expect(packageIndex).toBeLessThan(sealIndex)
    expect(sealIndex).toBeLessThan(buildIndex)
    expect(packageIndex).toBeLessThan(buildIndex)
    expect(buildIndex).toBeLessThan(verifyArtifactsIndex)
    expect(verifyArtifactsIndex).toBeLessThan(verifyIndex)
    expect(buildIndex).toBeLessThan(verifyIndex)
    expect(verifyIndex).toBeLessThan(verifyQuarantineIndex)
    expect(verifyIndex).toBeLessThan(uploadIndex)
    expect(workflow).toContain(
      'run: node apps/desktop/scripts/mac-adhoc-seal.cjs verify-quarantine-installed'
    )
    expect(workflow).not.toContain('/Applications/One Works.app')
    expect(workflow).toContain(
      'Unsigned desktop release candidates must contain a complete ad-hoc bundle seal.'
    )
    expect(workflow).toContain('Retain existing release backup')
    expect(workflow).toContain('retention-days: 90')
    expect(workflow).toContain('Replacement failed; restoring archived Release assets.')
    expect(workflow).toContain('verify_remote_directory release-artifacts')
    const releaseScriptSyntax = spawnSync('bash', ['--noprofile', '--norc', '-n'], {
      encoding: 'utf8',
      input: extractRunScript('Create or update GitHub Release')
    })
    expect(releaseScriptSyntax.status, releaseScriptSyntax.stderr).toBe(0)
    expect(workflow.indexOf('verify_remote_directory release-artifacts')).toBeLessThan(
      workflow.indexOf('gh release edit "$TAG" --latest --notes "$NOTES"')
    )
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
      'true',
      '- Unsigned macOS installers with a complete ad-hoc bundle seal; Gatekeeper still requires manual approval'
    ],
    [
      'false',
      'false',
      '- Unsigned macOS installers; Gatekeeper may require manual approval'
    ],
    [
      'true',
      'false',
      '- Developer ID signed and Apple-notarized macOS installers'
    ]
  ])('writes accurate release notes when signed=%s and adHocSealed=%s', (signed, adHocSealed, expectedNote) => {
    const result = runWithOutput(
      extractRunScript('Resolve release notes'),
      {
        AD_HOC_SEALED: adHocSealed,
        BUILDER_SHA: 'b'.repeat(40),
        REPLACE_EXISTING_RELEASE: 'false',
        SIGNED: signed,
        SOURCE_SHA: 'a'.repeat(40),
        TAG: 'pkg/oneworks-desktop/v0.1.0-beta.10'
      }
    )

    expect(result.status).toBe(0)
    expect(result.output).toContain(expectedNote)
    expect(result.output).toContain(
      '- Intel (x64) and Apple Silicon (arm64): .dmg, .pkg, .zip'
    )
    expect(result.output).toContain(`- Product source: ${'a'.repeat(40)}`)
    expect(result.output).toContain(`- Release builder: ${'b'.repeat(40)}`)
  })

  it('warns that same-version desktop asset replacements require a re-download', () => {
    const result = runWithOutput(
      extractRunScript('Resolve release notes'),
      {
        AD_HOC_SEALED: 'true',
        BUILDER_SHA: 'b'.repeat(40),
        REPLACE_EXISTING_RELEASE: 'true',
        SIGNED: 'false',
        SOURCE_SHA: 'a'.repeat(40),
        TAG: 'pkg/oneworks-desktop/v0.2.0'
      }
    )
    expect(result.status, result.stderr).toBe(0)
    expect(result.output).toContain('Existing 0.2.0 users must re-download')
    expect(result.output).toContain('same-version assets do not auto-update')
  })
})
