/* eslint-disable max-lines -- one workflow contract is intentionally exercised end to end. */
import { spawnSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const workflow = readFileSync('.github/workflows/desktop-package.yml', 'utf8')
const electronBuilderConfig = readFileSync('apps/desktop/electron-builder.yml', 'utf8')
const desktopPackageScript = readFileSync('apps/desktop/scripts/package.cjs', 'utf8')
const macosSigningRule = readFileSync('.oo/rules/release/macos-signing.md', 'utf8')
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

function extractStep(stepName: string) {
  const stepMarker = `      - name: ${stepName}\n`
  const stepStart = workflow.indexOf(stepMarker)
  expect(stepStart).toBeGreaterThanOrEqual(0)
  const nextStep = workflow.indexOf('\n      - name:', stepStart + stepMarker.length)
  return workflow.slice(stepStart, nextStep === -1 ? workflow.length : nextStep)
}

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

function runSigningIdentityImport(codesignStatus = 0) {
  const commandDir = mkdtempSync(path.join(tmpdir(), 'oneworks-desktop-signing-bin-'))
  const runnerTemp = mkdtempSync(path.join(tmpdir(), 'oneworks-desktop-signing-runner-'))
  const commandLog = path.join(runnerTemp, 'commands.log')
  const githubEnv = path.join(runnerTemp, 'github-env')

  const commands = {
    base64: '#!/usr/bin/env bash\ncat\n',
    codesign:
      `#!/usr/bin/env bash\nprintf 'codesign %s\\n' "$*" >> "$FAKE_COMMAND_LOG"\nif [[ "$1" == "--sign" ]]; then exit "$FAKE_CODESIGN_STATUS"; fi\n`,
    openssl: '#!/usr/bin/env bash\nprintf "temporary-keychain-password\\n"\n',
    security:
      `#!/usr/bin/env bash\nprintf 'security %s\\n' "$*" >> "$FAKE_COMMAND_LOG"\nif [[ "$1" == "find-identity" ]]; then\n  printf '  1) AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA "Developer ID Application: Example (TEAMID)"\\n'\nfi\n`
  }

  for (const [name, source] of Object.entries(commands)) {
    const commandPath = path.join(commandDir, name)
    writeFileSync(commandPath, source)
    chmodSync(commandPath, 0o755)
  }

  try {
    const result = runBash(
      extractRunScript('Import desktop application signing identity'),
      {
        DESKTOP_CSC_KEY_PASSWORD: 'certificate-password',
        DESKTOP_CSC_LINK: 'certificate-bytes',
        FAKE_CODESIGN_STATUS: String(codesignStatus),
        FAKE_COMMAND_LOG: commandLog,
        GITHUB_ENV: githubEnv,
        PATH: `${commandDir}:${process.env.PATH}`,
        RUNNER_TEMP: runnerTemp
      }
    )
    const log = readFileSync(commandLog, 'utf8')
    const exportedEnv = result.status === 0 ? readFileSync(githubEnv, 'utf8') : ''
    return { ...result, exportedEnv, log }
  } finally {
    rmSync(commandDir, { force: true, recursive: true })
    rmSync(runnerTemp, { force: true, recursive: true })
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
    expect(macosSigningRule).toContain('纯文档 PR 只运行轻量门禁')
    expect(macosSigningRule).toContain('其他普通 PR 只构建 unsigned app bundle')

    const nightlyPolicy = runWithOutput(
      extractRunScript('Resolve desktop build policy'),
      {
        DESKTOP_SIGN_CAPABLE: 'true',
        EVENT_NAME: 'schedule',
        MANIFEST_SIGNING_POLICY: 'auto',
        REQUESTED_SIGNING_POLICY: 'auto'
      }
    )
    expect(nightlyPolicy.status).toBe(0)
    expect(nightlyPolicy.output).toContain('archs=arm64')
    expect(nightlyPolicy.output).toContain('make_targets=dmg')
    expect(nightlyPolicy.output).toContain('sign=false')
  })

  it.each([
    ['alpha', 'auto', 'auto', 'unsigned', 'false'],
    ['beta', 'auto', 'auto', 'unsigned', 'false'],
    ['rc', 'auto', 'auto', 'signed', 'true'],
    ['rc', 'unsigned', 'unsigned', 'unsigned', 'false']
  ])(
    'resolves %s requested=%s manifest=%s to %s',
    (channel, requestedPolicy, manifestPolicy, effectivePolicy, sign) => {
      const policy = runWithOutput(
        extractRunScript('Resolve desktop build policy'),
        {
          CREATE_RELEASE_REQUESTED: 'false',
          DESKTOP_RELEASE_TAG_PREFIX: 'pkg/oneworks-desktop/v',
          DESKTOP_SIGN_CAPABLE: 'true',
          EVENT_NAME: 'workflow_dispatch',
          GITHUB_REF: 'refs/heads/main',
          MANIFEST_SIGNING_POLICY: manifestPolicy,
          NOTARIZATION_RECOVERY: 'false',
          RELEASE_CHANNEL: channel,
          RELEASE_ENABLED: 'true',
          REQUESTED_SIGNING_POLICY: requestedPolicy
        }
      )

      expect(policy.status, policy.stderr).toBe(0)
      expect(policy.output).toContain(`effective_policy=${effectivePolicy}`)
      expect(policy.output).toContain(`sign=${sign}`)
    }
  )

  it('fails stable unsigned and preserves immutable official and recovery policies', () => {
    const script = extractRunScript('Resolve desktop build policy')
    const baseEnv = {
      DESKTOP_RELEASE_TAG_PREFIX: 'pkg/oneworks-desktop/v',
      DESKTOP_SIGN_CAPABLE: 'true',
      EVENT_NAME: 'workflow_dispatch',
      GITHUB_REF: 'refs/heads/main',
      NOTARIZATION_RECOVERY: 'false',
      RELEASE_ENABLED: 'true'
    }
    const stableUnsigned = runWithOutput(script, {
      ...baseEnv,
      CREATE_RELEASE_REQUESTED: 'false',
      MANIFEST_SIGNING_POLICY: 'auto',
      RELEASE_CHANNEL: 'stable',
      REQUESTED_SIGNING_POLICY: 'unsigned'
    })
    const driftingCandidateRc = runWithOutput(script, {
      ...baseEnv,
      CREATE_RELEASE_REQUESTED: 'false',
      MANIFEST_SIGNING_POLICY: 'auto',
      RELEASE_CHANNEL: 'rc',
      REQUESTED_SIGNING_POLICY: 'unsigned'
    })
    const driftingSignedCandidateRc = runWithOutput(script, {
      ...baseEnv,
      CREATE_RELEASE_REQUESTED: 'false',
      MANIFEST_SIGNING_POLICY: 'unsigned',
      RELEASE_CHANNEL: 'rc',
      REQUESTED_SIGNING_POLICY: 'signed'
    })
    const lockedOfficialRc = runWithOutput(script, {
      ...baseEnv,
      CREATE_RELEASE_REQUESTED: 'true',
      MANIFEST_SIGNING_POLICY: 'unsigned',
      RELEASE_CHANNEL: 'rc',
      REQUESTED_SIGNING_POLICY: 'unsigned'
    })
    const driftingRecovery = runWithOutput(script, {
      ...baseEnv,
      CREATE_RELEASE_REQUESTED: 'false',
      MANIFEST_SIGNING_POLICY: 'unsigned',
      NOTARIZATION_RECOVERY: 'true',
      RELEASE_CHANNEL: 'rc',
      REQUESTED_SIGNING_POLICY: 'signed'
    })

    expect(stableUnsigned.status).toBe(1)
    expect(stableUnsigned.stderr).toContain('Stable Desktop releases must be Developer ID signed')
    expect(driftingCandidateRc.status).toBe(1)
    expect(driftingCandidateRc.stderr).toContain('must match the immutable effective package policy')
    expect(driftingSignedCandidateRc.status).toBe(1)
    expect(driftingSignedCandidateRc.stderr).toContain(
      'must match the immutable effective package policy'
    )
    expect(lockedOfficialRc.status, lockedOfficialRc.stderr).toBe(0)
    expect(lockedOfficialRc.output).toContain('effective_policy=unsigned')
    expect(driftingRecovery.status).toBe(1)
    expect(driftingRecovery.stderr).toContain('must match the immutable effective package policy')
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
    expect(workflow).toContain('notarization_history_only:')
    expect(workflow).toContain('notarization_run_id:')
    expect(workflow).toContain('notarization_stage:')
    expect(workflow).toContain('product_source_sha cannot be combined with candidate_run_id.')
    expect(workflow).toContain("inputs.candidate_run_id != ''")
    expect(workflow).toContain(
      `run-id: \${{ github.event_name == 'workflow_dispatch' && inputs.candidate_run_id || github.run_id }}`
    )
    expect(workflow).toContain(
      'node apps/desktop/scripts/release-candidate-manifest.cjs verify release-artifacts'
    )
    expect(workflow).toContain('name: Verify immutable signing policy source')
    expect(workflow).toContain(
      'Desktop candidate immutable signing policy does not match its product source.'
    )
    const immutablePolicySyntax = spawnSync('bash', ['--noprofile', '--norc', '-n'], {
      encoding: 'utf8',
      input: extractRunScript('Verify immutable signing policy source')
    })
    expect(immutablePolicySyntax.status, immutablePolicySyntax.stderr).toBe(0)
    expect(workflow).toContain(
      'actions: read\n      artifact-metadata: write\n      attestations: write\n      contents: write\n      id-token: write'
    )
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
    expect(workflow).toContain(
      'ref: $' + '{{ steps.notarization_recovery.outputs.source_sha || inputs.product_source_sha }}'
    )
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
    expect(workflow).toContain('release_automation: ${{ contains(inputs.release_tag || github.ref_name')
    expect(workflow).not.toContain('secrets: inherit')
    expect(workflow).toContain(
      `HOMEPAGE_DEPLOY_TOKEN: \${{ secrets.HOMEPAGE_DEPLOY_TOKEN }}`
    )
    expect(homepageWorkflow).toContain(
      'secrets:\n      HOMEPAGE_DEPLOY_TOKEN:'
    )
  })

  it('attests the verified immutable Desktop artifact set before publication', () => {
    const verificationIndex = workflow.indexOf('      - name: Verify release tag source')
    const attestationIndex = workflow.indexOf('      - name: Attest verified Desktop release artifacts')
    const publicationIndex = workflow.indexOf('      - name: Create or update GitHub Release')

    expect(verificationIndex).toBeGreaterThanOrEqual(0)
    expect(attestationIndex).toBeGreaterThan(verificationIndex)
    expect(publicationIndex).toBeGreaterThan(attestationIndex)
    expect(workflow).toContain('uses: actions/attest@v4')
    expect(workflow).toContain('subject-path: release-artifacts/*')
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
        DESKTOP_SIGN_CAPABLE: 'true',
        EVENT_NAME: 'workflow_dispatch',
        MANIFEST_SIGNING_POLICY: 'auto',
        RELEASE_ENABLED: 'false',
        REQUESTED_SIGNING_POLICY: 'auto'
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
    expect(workflow).toContain(
      'ONEWORKS_DESKTOP_SIGNING_POLICY: $' +
        '{{ steps.desktop_build_policy.outputs.effective_policy }}'
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

  it('persists asynchronous app and installer notarization before bounded waits', () => {
    const importIndex = workflow.indexOf(
      '      - name: Import desktop application signing identity'
    )
    const packageIndex = workflow.indexOf('      - name: Package desktop app')
    const preNotarizationVerifyIndex = workflow.indexOf(
      '      - name: Verify signed apps before notarization'
    )
    const verifyIndex = workflow.indexOf(
      '      - name: Verify signed and notarized macOS app bundles'
    )
    const recoveryDiagnosticIndex = workflow.indexOf(
      '      - name: Diagnose packaged filesystem authority before notarization'
    )
    const packagedSmokeIndex = workflow.indexOf(
      '      - name: Smoke test packaged server'
    )
    const prepareAppIndex = workflow.indexOf(
      '      - name: Prepare signed app notarization recovery state'
    )
    const submitAppIndex = workflow.indexOf(
      '      - name: Submit signed apps for notarization without waiting'
    )
    const retainAppIndex = workflow.indexOf(
      '      - name: Retain exact signed app notarization recovery state'
    )
    const resumeAppIndex = workflow.indexOf(
      '      - name: Reconcile and submit app notarization recovery state'
    )
    const bindAppIndex = workflow.indexOf(
      '      - name: Bind updated app notarization recovery state to this run'
    )
    const retainUpdatedAppIndex = workflow.indexOf(
      '      - name: Retain updated app notarization recovery state'
    )
    const waitAppIndex = workflow.indexOf(
      '      - name: Wait for existing app notarization submissions'
    )
    const buildIndex = workflow.indexOf('      - name: Build desktop artifacts')
    const prepareInstallerIndex = workflow.indexOf(
      '      - name: Prepare installer notarization recovery state'
    )
    const submitInstallerIndex = workflow.indexOf(
      '      - name: Submit installers for notarization without waiting'
    )
    const retainInstallerIndex = workflow.indexOf(
      '      - name: Retain exact installer notarization recovery state'
    )
    const resumeInstallerIndex = workflow.indexOf(
      '      - name: Reconcile and submit installer notarization recovery state'
    )
    const bindInstallerIndex = workflow.indexOf(
      '      - name: Bind updated installer notarization recovery state to this run'
    )
    const retainUpdatedInstallerIndex = workflow.indexOf(
      '      - name: Retain updated installer notarization recovery state'
    )
    const waitInstallerIndex = workflow.indexOf(
      '      - name: Wait for existing installer notarization submissions'
    )
    const cleanupIndex = workflow.indexOf(
      '      - name: Remove temporary desktop signing keychain'
    )

    expect(importIndex).toBeGreaterThanOrEqual(0)
    expect(importIndex).toBeLessThan(packageIndex)
    expect(packageIndex).toBeLessThan(preNotarizationVerifyIndex)
    expect(preNotarizationVerifyIndex).toBeLessThan(recoveryDiagnosticIndex)
    expect(recoveryDiagnosticIndex).toBeLessThan(prepareAppIndex)
    expect(prepareAppIndex).toBeLessThan(submitAppIndex)
    expect(submitAppIndex).toBeLessThan(retainAppIndex)
    expect(retainAppIndex).toBeLessThan(waitAppIndex)
    expect(retainAppIndex).toBeLessThan(resumeAppIndex)
    expect(recoveryDiagnosticIndex).toBeLessThan(resumeAppIndex)
    expect(resumeAppIndex).toBeLessThan(bindAppIndex)
    expect(bindAppIndex).toBeLessThan(retainUpdatedAppIndex)
    expect(retainUpdatedAppIndex).toBeLessThan(waitAppIndex)
    expect(waitAppIndex).toBeLessThan(verifyIndex)
    expect(packageIndex).toBeLessThan(verifyIndex)
    expect(verifyIndex).toBeLessThan(packagedSmokeIndex)
    expect(verifyIndex).toBeLessThan(buildIndex)
    expect(buildIndex).toBeLessThan(prepareInstallerIndex)
    expect(prepareInstallerIndex).toBeLessThan(submitInstallerIndex)
    expect(submitInstallerIndex).toBeLessThan(retainInstallerIndex)
    expect(retainInstallerIndex).toBeLessThan(waitInstallerIndex)
    expect(retainInstallerIndex).toBeLessThan(resumeInstallerIndex)
    expect(resumeInstallerIndex).toBeLessThan(bindInstallerIndex)
    expect(bindInstallerIndex).toBeLessThan(retainUpdatedInstallerIndex)
    expect(retainUpdatedInstallerIndex).toBeLessThan(waitInstallerIndex)
    expect(workflow).toContain('desktop-app-notarization-recovery')
    expect(workflow).toContain('desktop-installer-notarization-recovery')
    expect(workflow).toContain('--timeout-minutes 20')
    expect(workflow).toContain('--build-branch "$' + '{{ steps.desktop_build_source.outputs.branch }}"')
    expect(workflow).toContain('--build-time "$' + '{{ steps.desktop_build_source.outputs.time }}"')
    expect(workflow).toContain('--run-id "$GITHUB_RUN_ID"')
    expect(workflow).toContain('--run-attempt "$GITHUB_RUN_ATTEMPT"')
    expect(workflow).toContain('RECOVERY_BUILD_TIME: $' + '{{ steps.notarization_recovery.outputs.build_time }}')
    expect(workflow).toContain('RECOVERY_BUILD_BRANCH: $' + '{{ steps.notarization_recovery.outputs.build_branch }}')
    expect(extractRunScript('Wait for existing app notarization submissions')).not.toContain(' submit ')
    expect(extractRunScript('Wait for existing installer notarization submissions')).not.toContain(' submit ')
    expect(extractRunScript('Reconcile and submit app notarization recovery state')).toContain(' reconcile ')
    expect(extractRunScript('Reconcile and submit installer notarization recovery state')).toContain(' reconcile ')
    expect(workflow).toContain('ONEWORKS_DESKTOP_DEFER_NOTARIZATION')
    expect(buildIndex).toBeLessThan(cleanupIndex)
    expect(workflow).toContain('ONEWORKS_DESKTOP_SIGNING_KEYCHAIN=$keychain')
    expect(workflow).toContain('security set-key-partition-list')
    expect(workflow).toContain('security list-keychains -d user -s "$keychain"')
    expect(workflow).toMatch(
      /ONEWORKS_DESKTOP_SIGN: \$\{\{ steps\.desktop_build_policy\.outputs\.sign \}\}/u
    )
    expect(workflow).toContain('verify-macos-signed-apps.cjs')
    expect(workflow).toContain("if: always() && steps.desktop_build_policy.outputs.sign == 'true'")

    expect(electronBuilderConfig).not.toContain('afterSign:')
    expect(electronBuilderConfig).toContain(
      'afterAllArtifactBuild: scripts/notarize-artifacts.cjs'
    )
    expect(electronBuilderConfig).toMatch(/mac:\n(?: {2}.+\n)* {2}notarize: false\n/u)
    expect(electronBuilderConfig).toMatch(/dmg:\n(?: {2}.+\n)* {2}writeUpdateInfo: false\n/u)
    expect(desktopPackageScript).toContain('afterCopyExtraResources:')
    expect(desktopPackageScript).not.toContain('afterCopy:')
    expect(desktopPackageScript.indexOf('rewriteStagingSymlinks(packagedAppRoot')).toBeLessThan(
      desktopPackageScript.indexOf('...signingOptions')
    )
    expect(workflow).not.toContain('APPLE_APP_SPECIFIC_PASSWORD')
    expect(macosSigningRule).toContain(
      '`security find-identity` 只能证明 identity 可枚举'
    )
  })

  it('runs the current-builder authority diagnostic before Apple work while unsigned and installer recovery skip', () => {
    const diagnosticName = 'Diagnose packaged filesystem authority before notarization'
    const diagnosticStep = extractStep(diagnosticName)
    const productSmokeStep = extractStep('Smoke test packaged server')
    const diagnosticIndex = workflow.indexOf(`      - name: ${diagnosticName}`)
    const preNotarizationVerifyIndex = workflow.indexOf(
      '      - name: Verify signed apps before notarization'
    )
    const prepareIndex = workflow.indexOf(
      '      - name: Prepare signed app notarization recovery state'
    )
    const reconcileIndex = workflow.indexOf(
      '      - name: Reconcile and submit app notarization recovery state'
    )
    const waitIndex = workflow.indexOf(
      '      - name: Wait for existing app notarization submissions'
    )
    const finalVerifyIndex = workflow.indexOf(
      '      - name: Verify signed and notarized macOS app bundles'
    )
    const smokeIndex = workflow.indexOf('      - name: Smoke test packaged server')

    expect(diagnosticStep).toContain(
      "steps.desktop_build_policy.outputs.sign == 'true'"
    )
    expect(diagnosticStep).toContain(
      "(inputs.notarization_run_id == '' || inputs.notarization_stage == 'app')"
    )
    expect(diagnosticStep).toContain(
      'node "$GITHUB_WORKSPACE/apps/desktop/scripts/diagnose-packaged-authority.cjs"'
    )
    expect(diagnosticStep).toContain('working-directory: $' + '{{ steps.desktop_workspace.outputs.workspace_dir }}')
    expect(diagnosticStep).not.toContain('notarization-state.cjs')
    expect(diagnosticStep).not.toContain('APPLE_ID')
    expect(diagnosticStep).not.toContain('APPLE_ID_PASSWORD')
    expect(diagnosticStep).not.toContain('APPLE_TEAM_ID')
    expect(workflow.match(new RegExp(`      - name: ${diagnosticName}`, 'gu'))).toHaveLength(1)
    expect(workflow.match(/diagnose-packaged-authority\.cjs/gu)).toHaveLength(1)
    expect(workflow).not.toContain('Diagnose recovered packaged filesystem authority')
    expect(preNotarizationVerifyIndex).toBeLessThan(diagnosticIndex)
    expect(
      workflow.slice(preNotarizationVerifyIndex, diagnosticIndex).match(/^ {6}- name:/gmu)
    ).toHaveLength(1)
    expect(diagnosticIndex).toBeLessThan(prepareIndex)
    expect(diagnosticIndex).toBeLessThan(reconcileIndex)
    expect(diagnosticIndex).toBeLessThan(waitIndex)
    expect(finalVerifyIndex).toBeLessThan(smokeIndex)
    expect(productSmokeStep).toContain('run: pnpm -C apps/desktop smoke:package')
    expect(productSmokeStep).toContain("if: inputs.notarization_stage != 'installer'")
  })

  it('supports read-only history and exact recovery without combining remote mutations', () => {
    const script = extractRunScript('Validate desktop workflow request')
    const history = runBash(script, {
      CANDIDATE_RUN_ID: '',
      CREATE_RELEASE_REQUESTED: 'false',
      NOTARIZATION_HISTORY_ONLY: 'true',
      NOTARIZATION_RUN_ID: '',
      NOTARIZATION_STAGE: '',
      REPLACE_EXISTING_RELEASE: 'false'
    })
    const recovery = runBash(script, {
      CANDIDATE_RUN_ID: '',
      CREATE_RELEASE_REQUESTED: 'false',
      NOTARIZATION_HISTORY_ONLY: 'false',
      NOTARIZATION_RUN_ID: '31527515015',
      NOTARIZATION_STAGE: 'app',
      REPLACE_EXISTING_RELEASE: 'false'
    })
    const invalidRecovery = runBash(script, {
      CANDIDATE_RUN_ID: '',
      CREATE_RELEASE_REQUESTED: 'false',
      NOTARIZATION_HISTORY_ONLY: 'false',
      NOTARIZATION_RUN_ID: '31527515015',
      NOTARIZATION_STAGE: 'unknown',
      REPLACE_EXISTING_RELEASE: 'false'
    })
    const driftingRecoveryPolicy = runBash(script, {
      CANDIDATE_RUN_ID: '',
      CREATE_RELEASE_REQUESTED: 'false',
      NOTARIZATION_HISTORY_ONLY: 'false',
      NOTARIZATION_RUN_ID: '31527515015',
      NOTARIZATION_STAGE: 'app',
      REPLACE_EXISTING_RELEASE: 'false',
      SIGNING_POLICY: 'unsigned'
    })
    const mixedHistory = runBash(script, {
      BUILDER_SOURCE_SHA: '',
      CANDIDATE_RUN_ID: '',
      CREATE_RELEASE_REQUESTED: 'false',
      NOTARIZATION_HISTORY_ONLY: 'true',
      NOTARIZATION_RUN_ID: '',
      NOTARIZATION_STAGE: '',
      PRODUCT_SOURCE_SHA: 'a'.repeat(40),
      RELEASE_TAG_INPUT: '',
      REPLACE_EXISTING_RELEASE: 'false'
    })
    const mixedRecovery = runBash(script, {
      BUILDER_SOURCE_SHA: 'b'.repeat(40),
      CANDIDATE_RUN_ID: '',
      CREATE_RELEASE_REQUESTED: 'false',
      NOTARIZATION_HISTORY_ONLY: 'false',
      NOTARIZATION_RUN_ID: '31527515015',
      NOTARIZATION_STAGE: 'app',
      PRODUCT_SOURCE_SHA: 'a'.repeat(40),
      RELEASE_TAG_INPUT: '',
      REPLACE_EXISTING_RELEASE: 'false'
    })
    const installerWorkspace = runWithOutput(
      extractRunScript('Resolve desktop workspace'),
      {
        GITHUB_SHA: 'c'.repeat(40),
        NOTARIZATION_BUILDER_SHA: 'b'.repeat(40),
        NOTARIZATION_SOURCE_SHA: 'a'.repeat(40),
        NOTARIZATION_STAGE: 'installer',
        PRODUCT_SOURCE_SHA: ''
      }
    )
    const appWorkspace = runWithOutput(
      extractRunScript('Resolve desktop workspace'),
      {
        GITHUB_SHA: 'c'.repeat(40),
        NOTARIZATION_BUILDER_SHA: 'b'.repeat(40),
        NOTARIZATION_SOURCE_SHA: 'a'.repeat(40),
        NOTARIZATION_STAGE: 'app',
        PRODUCT_SOURCE_SHA: ''
      }
    )

    expect(history.status, history.stderr).toBe(0)
    expect(recovery.status, recovery.stderr).toBe(0)
    expect(invalidRecovery.status).toBe(1)
    expect(invalidRecovery.stderr).toContain('notarization_stage must be app or installer')
    expect(driftingRecoveryPolicy.status).toBe(1)
    expect(driftingRecoveryPolicy.stderr).toContain('cannot change the effective signing policy')
    expect(mixedHistory.status).toBe(1)
    expect(mixedHistory.stderr).toContain('notarization_history_only cannot be combined')
    expect(mixedRecovery.status).toBe(1)
    expect(mixedRecovery.stderr).toContain('notarization recovery cannot be combined')
    expect(installerWorkspace.status, installerWorkspace.stderr).toBe(0)
    expect(installerWorkspace.output).toContain(`builder_sha=${'b'.repeat(40)}`)
    expect(appWorkspace.status, appWorkspace.stderr).toBe(0)
    expect(appWorkspace.output).toContain(`builder_sha=${'c'.repeat(40)}`)
    expect(workflow).toContain('name: Apple notarization history')
    expect(workflow).toContain('Query Apple notarization history')
    expect(workflow).toContain('Download notarization recovery state')
    expect(workflow).toContain('inputs.notarization_history_only')
  })

  it('fails historical product signing before blocking notarization tooling can run', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'oneworks-desktop-product-tooling-'))
    const scriptsDir = path.join(root, 'apps', 'desktop', 'scripts')
    mkdirSync(scriptsDir, { recursive: true })
    mkdirSync(path.join(root, 'patches'), { recursive: true })
    writeFileSync(path.join(scriptsDir, 'mac-signing-options.cjs'), 'module.exports = { osxSign: {} }\n')
    writeFileSync(
      path.join(scriptsDir, 'notarize-artifacts.cjs'),
      'process.env.ONEWORKS_DESKTOP_DEFER_NOTARIZATION\n'
    )
    writeFileSync(
      path.join(root, 'pnpm-workspace.yaml'),
      "patchedDependencies:\n  '@electron/osx-sign@2.4.0': patches/@electron__osx-sign@2.4.0.patch\n"
    )
    writeFileSync(path.join(root, 'apps', 'desktop', 'electron-builder.yml'), 'dmg:\n  writeUpdateInfo: false\n')
    writeFileSync(path.join(root, 'patches', '@electron__osx-sign@2.4.0.patch'), 'patch')

    try {
      const script = extractRunScript('Validate recoverable product signing tooling')
      const current = runBash(script, { PRODUCT_WORKSPACE: root })
      expect(current.status, current.stderr).toBe(0)

      writeFileSync(
        path.join(scriptsDir, 'mac-signing-options.cjs'),
        'module.exports = { osxNotarize: {} }\n'
      )
      const historical = runBash(script, { PRODUCT_WORKSPACE: root })
      expect(historical.status).toBe(1)
      expect(historical.stderr).toContain('predates the recoverable Desktop signing toolchain')
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })

  it('binds recovery artifacts to the exact failed workflow run and attempt', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'oneworks-desktop-recovery-run-'))
    const commandDir = path.join(root, 'bin')
    const stateDir = path.join(root, 'state')
    mkdirSync(commandDir, { recursive: true })
    mkdirSync(stateDir, { recursive: true })
    const runId = '31527515015'
    const headSha = 'b'.repeat(40)
    const state = {
      artifactProvenance: {
        headSha,
        runAttempt: 1,
        runId,
        workflowPath: '.github/workflows/desktop-package.yml'
      },
      buildBranch: 'main',
      builderSha: headSha,
      buildTime: '2026-08-11T12:00:00.000Z',
      releaseTag: 'pkg/oneworks-desktop/v1.0.0-rc.2',
      schemaVersion: 1,
      sourceSha: 'a'.repeat(40),
      stage: 'app'
    }
    writeFileSync(path.join(stateDir, 'notarization-state.json'), JSON.stringify(state))
    const ghPath = path.join(commandDir, 'gh')
    writeFileSync(ghPath, '#!/usr/bin/env bash\nprintf "%s" "$FAKE_RUN_JSON"\n')
    chmodSync(ghPath, 0o755)
    const validRun = {
      conclusion: 'cancelled',
      head_sha: headSha,
      id: Number(runId),
      path: '.github/workflows/desktop-package.yml',
      repository: { full_name: 'oneworks-ai/app' },
      run_attempt: 1,
      status: 'completed'
    }
    const execute = (run: Record<string, unknown>) =>
      runWithOutput(extractRunScript('Inspect notarization recovery state'), {
        EXPECTED_STAGE: 'app',
        FAKE_RUN_JSON: JSON.stringify(run),
        GH_TOKEN: 'token',
        GITHUB_REPOSITORY: 'oneworks-ai/app',
        NOTARIZATION_RUN_ID: runId,
        PATH: `${commandDir}:${process.env.PATH}`,
        REQUESTED_RELEASE_TAG: state.releaseTag,
        RUNNER_TEMP: root,
        STATE_DIR: stateDir
      })

    try {
      const valid = execute(validRun)
      expect(valid.status, valid.stderr).toBe(0)
      expect(valid.output).toContain(`source_sha=${state.sourceSha}`)

      const mismatched = execute({ ...validRun, head_sha: 'c'.repeat(40) })
      expect(mismatched.status).toBe(1)
      expect(mismatched.stderr).toContain('does not match the requested stage or source contract')
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })

  it('proves the imported identity is usable by codesign before packaging', () => {
    const result = runSigningIdentityImport()

    expect(result.status, result.stderr).toBe(0)
    expect(result.log).toContain(
      'security list-keychains -d user -s '
    )
    expect(result.log).toContain(
      'codesign --sign AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA --force --keychain '
    )
    expect(result.log).toContain('--timestamp --options runtime')
    expect(result.log).toContain('codesign --verify --strict')
    expect(result.log.indexOf('security list-keychains')).toBeLessThan(
      result.log.indexOf('codesign --sign')
    )
    expect(result.exportedEnv).toMatch(
      /^ONEWORKS_DESKTOP_SIGNING_KEYCHAIN=.+oneworks-desktop-signing\.keychain-db$/mu
    )
  })

  it('fails before exporting the keychain when the codesign probe cannot use the identity', () => {
    const result = runSigningIdentityImport(1)

    expect(result.status).toBe(1)
    expect(result.log).toContain('codesign --sign')
    expect(result.log).not.toContain('codesign --verify --strict')
    expect(result.exportedEnv).toBe('')
  })

  it.each([
    [
      'false',
      'true',
      '- Unsigned macOS installers with a complete ad-hoc bundle seal; no Apple notarization was requested, and Gatekeeper still requires manual approval'
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
        EFFECTIVE_SIGNING_POLICY: signed === 'true' ? 'signed' : 'unsigned',
        REPLACE_EXISTING_RELEASE: 'false',
        SIGNED: signed,
        SOURCE_SHA: 'a'.repeat(40),
        TAG: 'pkg/oneworks-desktop/v0.1.0-beta.10'
      }
    )

    expect(result.status).toBe(0)
    expect(result.output).toContain(expectedNote)
    expect(result.output).toContain(
      `- Effective macOS signing policy: ${signed === 'true' ? 'signed' : 'unsigned'}`
    )
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
        EFFECTIVE_SIGNING_POLICY: 'unsigned',
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
