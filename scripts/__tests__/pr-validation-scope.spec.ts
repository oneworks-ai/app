/* eslint-disable max-lines -- Validation classification and all protected workflow contracts stay in one audit suite. */
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { evaluatePrChangePolicy } from '../pr-change-policy'
import {
  classifyChangedPaths,
  classifyPrValidationRange,
  fullTypecheckScopes,
  isDocumentationPath,
  prValidationScopeVersion
} from '../pr-validation-scope.cjs'

const runGit = (cwd: string, args: string[]) =>
  execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  }).trim()

describe('pr validation scope', () => {
  it('classifies ordinary Markdown and internal module rules as docs-only', () => {
    const scope = classifyChangedPaths([
      'apps/client/AGENTS.md',
      '.oo/rules/architecture/dependencies.md'
    ])

    expect(scope).toMatchObject({
      clientBuild: false,
      desktopPackage: false,
      docsChanged: true,
      docsMedia: false,
      docsOnly: true,
      envContract: false,
      format: true,
      full: false,
      lint: false,
      policyDocs: false,
      publicDocs: false,
      releaseDocs: false,
      typecheck: false,
      typecheckScopes: [],
      unknown: false,
      version: prValidationScopeVersion
    })
    expect(scope.nonDocsFiles).toEqual([])
  })

  it('does not turn shared-package documentation into a client production build', () => {
    expect(classifyChangedPaths([
      'packages/adapters/codex/AGENTS.md',
      'packages/avatar/README.md'
    ])).toMatchObject({
      clientBuild: false,
      desktopPackage: false,
      docsOnly: true,
      typecheck: false
    })
  })

  it('adds public-doc validation for root READMEs and .oo/docs media', () => {
    const scope = classifyChangedPaths([
      'README.md',
      '.oo/docs/usage/install.md',
      '.oo/docs/images/install.png'
    ])

    expect(scope).toMatchObject({
      docsChanged: true,
      docsMedia: true,
      docsOnly: true,
      full: false,
      publicDocs: true
    })
  })

  it('targets client-only validation without scheduling macOS packaging', () => {
    const scope = classifyChangedPaths([
      'apps/client/src/components/chat/ChatView.tsx',
      'apps/client/__tests__/chat-view.spec.tsx',
      'changelog/1.2.3/client.md'
    ])

    expect(scope).toMatchObject({
      clientBuild: true,
      desktopPackage: false,
      docsMedia: false,
      envContract: true,
      lint: true,
      typecheck: true,
      typecheckScopes: ['web', 'web:test'],
      unknown: false
    })
  })

  it('builds client production assets even when a style-only change needs no typecheck', () => {
    expect(classifyChangedPaths(['apps/client/src/styles/theme.css'])).toMatchObject({
      clientBuild: true,
      desktopPackage: false,
      typecheck: false,
      typecheckScopes: []
    })
  })

  it('keeps adapter and brand-only changes off macOS while typechecking adapter code safely', () => {
    expect(classifyChangedPaths(['assets/brand/logo.svg'])).toMatchObject({
      clientBuild: false,
      desktopPackage: false,
      lint: false,
      typecheck: false
    })
    expect(classifyChangedPaths(['packages/adapters/codex/src/index.ts'])).toMatchObject({
      clientBuild: true,
      desktopPackage: false,
      typecheckScopes: fullTypecheckScopes
    })
  })

  it('runs only node typecheck scopes for server-only changes and keeps desktop runtime coverage', () => {
    expect(classifyChangedPaths(['apps/server/src/index.ts'])).toMatchObject({
      clientBuild: false,
      desktopPackage: true,
      typecheckScopes: ['node', 'node:test']
    })
  })

  it('fails dependency graph and unknown paths closed to all targets', () => {
    expect(classifyChangedPaths(['pnpm-lock.yaml'])).toMatchObject({
      desktopPackage: true,
      typecheckScopes: fullTypecheckScopes,
      unknown: false
    })
    expect(classifyChangedPaths(['apps/client/package.json'])).toMatchObject({
      desktopPackage: true,
      typecheckScopes: fullTypecheckScopes
    })
    expect(classifyChangedPaths(['.gitmodules'])).toMatchObject({
      desktopPackage: true,
      typecheckScopes: fullTypecheckScopes
    })
    for (
      const configPath of [
        'apps/relay-admin/tsconfig.json',
        'packages/components/tsconfig.build.json',
        'packages/icon/tsconfig.json'
      ]
    ) {
      expect(classifyChangedPaths([configPath])).toMatchObject({
        desktopPackage: true,
        typecheck: true,
        typecheckScopes: fullTypecheckScopes
      })
    }
    expect(classifyChangedPaths(['new-surface/index.ts'])).toMatchObject({
      desktopPackage: true,
      docsMedia: true,
      typecheckScopes: fullTypecheckScopes,
      unknown: true,
      unknownFiles: ['new-surface/index.ts']
    })
  })

  it('treats validation reuse and workspace cache authority as Desktop-risk CI changes', () => {
    expect(classifyChangedPaths(['scripts/pr-validation-reuse.cjs'])).toMatchObject({
      desktopPackage: true,
      lint: true,
      typecheckScopes: []
    })
    expect(classifyChangedPaths(['.github/actions/setup-workspace/action.yml'])).toMatchObject({
      desktopPackage: true,
      lint: true
    })
  })

  it('routes exact gitlink pointer changes to their real consumers', () => {
    expect(classifyChangedPaths(['assets/demo-video'])).toMatchObject({
      desktopPackage: true,
      docsMedia: true,
      lint: true,
      typecheck: true,
      typecheckScopes: fullTypecheckScopes
    })
    expect(classifyChangedPaths(['assets/homepage'])).toMatchObject({
      desktopPackage: false,
      docsMedia: true,
      publicDocs: true,
      typecheck: false
    })
    expect(classifyChangedPaths(['assets/avatar'])).toMatchObject({
      desktopPackage: false,
      docsMedia: false,
      publicDocs: false,
      typecheck: false
    })
  })

  it('adds release preflight and policy review only to their relevant tiers', () => {
    const changelogScope = classifyChangedPaths(['changelog/1.2.3/readme.md'])
    expect(changelogScope).toMatchObject({
      docsOnly: true,
      policyDocs: false,
      releaseDocs: true
    })

    const releaseRuleScope = classifyChangedPaths(['.oo/rules/release/process.md'])
    expect(releaseRuleScope).toMatchObject({
      docsOnly: true,
      policyDocs: true,
      releaseDocs: true
    })

    const permissionScope = classifyChangedPaths(['.oo/rules/maintenance/task-planning.md'])
    expect(permissionScope).toMatchObject({
      docsOnly: true,
      policyDocs: true,
      releaseDocs: false
    })

    const mixedReleaseScope = classifyChangedPaths([
      'changelog/1.2.3/readme.md',
      'apps/server/src/index.ts'
    ])
    expect(mixedReleaseScope).toMatchObject({
      docsChanged: true,
      docsOnly: false,
      full: true,
      releaseDocs: true
    })
  })

  it.each([
    ['product source', ['apps/server/src/index.ts']],
    ['workflow', ['.github/workflows/quality.yml']],
    ['configuration', ['.codex/config.toml']],
    ['public docs executable configuration', ['.oo/docs/.vitepress/config.mts']],
    ['public docs package manifest', ['.oo/docs/package.json']],
    ['lockfile', ['pnpm-lock.yaml']],
    ['package manifest', ['packages/core/package.json']],
    ['script', ['scripts/pr-validation-scope.cjs']],
    ['test', ['scripts/__tests__/pr-validation-scope.spec.ts']],
    ['runtime skill Markdown', ['packages/plugins/browser-driver/skills/browser-driver/SKILL.md']],
    ['runtime spec Markdown', ['packages/plugins/standard-dev/specs/standard-dev-flow/index.md']],
    ['source asset Markdown', ['apps/client/src/assets/model-providers/SOURCES.md']]
  ])('fails %s changes closed to full CI', (_label, changedFiles) => {
    expect(classifyChangedPaths(changedFiles)).toMatchObject({
      docsChanged: false,
      docsOnly: false,
      full: true,
      nonDocsFiles: changedFiles
    })
  })

  it('keeps mixed documentation and source changes on full CI', () => {
    const scope = classifyChangedPaths(['README.md', 'apps/client/src/App.tsx'])
    expect(scope).toMatchObject({
      docsChanged: true,
      docsOnly: false,
      full: true,
      publicDocs: true,
      nonDocsFiles: ['apps/client/src/App.tsx']
    })
  })

  it('fails empty or explicitly forced scopes closed to full CI', () => {
    expect(classifyChangedPaths([])).toMatchObject({
      desktopPackage: true,
      docsOnly: false,
      full: true,
      typecheckScopes: fullTypecheckScopes,
      unknown: true
    })
    expect(classifyChangedPaths(['README.md'], { forceFull: true })).toMatchObject({
      desktopPackage: true,
      docsOnly: false,
      full: true,
      typecheckScopes: fullTypecheckScopes,
      unknown: true
    })
  })

  it('includes both sides of a rename so source-to-Markdown renames cannot bypass full CI', () => {
    const repository = mkdtempSync(path.join(tmpdir(), 'oneworks-pr-scope-rename-'))
    runGit(repository, ['init', '--quiet'])
    runGit(repository, ['config', 'user.name', 'One Works Test'])
    runGit(repository, ['config', 'user.email', 'test@example.com'])
    writeFileSync(path.join(repository, 'runtime.ts'), 'export const runtime = true\n')
    runGit(repository, ['add', 'runtime.ts'])
    runGit(repository, ['commit', '--quiet', '-m', 'test: add source'])
    const base = runGit(repository, ['rev-parse', 'HEAD'])

    renameSync(path.join(repository, 'runtime.ts'), path.join(repository, 'README.md'))
    runGit(repository, ['add', '--all'])
    runGit(repository, ['commit', '--quiet', '-m', 'docs: rename source'])

    expect(classifyPrValidationRange({ base, cwd: repository, head: 'HEAD' })).toMatchObject({
      docsOnly: false,
      full: true,
      changedFiles: ['README.md', 'runtime.ts'],
      nonDocsFiles: ['runtime.ts']
    })
  })

  it('keeps deleted release policy paths in the authoritative policy scope', () => {
    const repository = mkdtempSync(path.join(tmpdir(), 'oneworks-pr-scope-policy-delete-'))
    runGit(repository, ['init', '--quiet'])
    runGit(repository, ['config', 'user.name', 'One Works Test'])
    runGit(repository, ['config', 'user.email', 'test@example.com'])
    mkdirSync(path.join(repository, '.oo', 'rules', 'release'), { recursive: true })
    writeFileSync(path.join(repository, '.oo', 'rules', 'release', 'process.md'), '# Release\n')
    runGit(repository, ['add', '.'])
    runGit(repository, ['commit', '--quiet', '-m', 'docs: add release policy'])
    const base = runGit(repository, ['rev-parse', 'HEAD'])

    unlinkSync(path.join(repository, '.oo', 'rules', 'release', 'process.md'))
    runGit(repository, ['add', '--all'])
    runGit(repository, ['commit', '--quiet', '-m', 'docs: remove release policy'])
    const scope = classifyPrValidationRange({ base, cwd: repository, head: 'HEAD' })

    expect(scope).toMatchObject({
      changedFiles: ['.oo/rules/release/process.md'],
      docsOnly: true,
      policyDocs: true,
      releaseDocs: true
    })
    expect(
      evaluatePrChangePolicy({
        changedFiles: scope.changedFiles,
        commitSubjects: ['docs: remove release policy'],
        prBody: ''
      }).requiresPolicyConflictReview
    ).toBe(true)
  })

  it('keeps the policy source of a rename to ordinary docs in policy review scope', () => {
    const repository = mkdtempSync(path.join(tmpdir(), 'oneworks-pr-scope-policy-rename-'))
    runGit(repository, ['init', '--quiet'])
    runGit(repository, ['config', 'user.name', 'One Works Test'])
    runGit(repository, ['config', 'user.email', 'test@example.com'])
    mkdirSync(path.join(repository, '.oo', 'rules', 'release'), { recursive: true })
    mkdirSync(path.join(repository, 'docs'), { recursive: true })
    writeFileSync(path.join(repository, '.oo', 'rules', 'release', 'process.md'), '# Release policy\n')
    runGit(repository, ['add', '.'])
    runGit(repository, ['commit', '--quiet', '-m', 'docs: add release policy'])
    const base = runGit(repository, ['rev-parse', 'HEAD'])

    renameSync(
      path.join(repository, '.oo', 'rules', 'release', 'process.md'),
      path.join(repository, 'docs', 'release-guide.md')
    )
    runGit(repository, ['add', '--all'])
    runGit(repository, ['commit', '--quiet', '-m', 'docs: move release policy'])
    const scope = classifyPrValidationRange({ base, cwd: repository, head: 'HEAD' })

    expect(scope).toMatchObject({
      changedFiles: ['.oo/rules/release/process.md', 'docs/release-guide.md'],
      docsOnly: true,
      policyDocs: true,
      releaseDocs: true
    })
    expect(
      evaluatePrChangePolicy({
        changedFiles: scope.changedFiles,
        commitSubjects: ['docs: move release policy'],
        prBody: ''
      }).requiresPolicyConflictReview
    ).toBe(true)
  })

  it('does not treat docs-adjacent executable or config files as documentation', () => {
    expect(isDocumentationPath('assets/homepage/apps/docs/.vitepress/config.mts')).toBe(false)
    expect(isDocumentationPath('.oo/docs/images/example.png')).toBe(true)
    expect(isDocumentationPath('.oo/docs/.vitepress/config.mts')).toBe(false)
    expect(isDocumentationPath('.oo/docs/package.json')).toBe(false)
    expect(isDocumentationPath('packages/channels/lark/debugging/evidence.md')).toBe(true)
    expect(isDocumentationPath('packages/plugins/cli-skills/skills/create-plugin/SKILL.md')).toBe(false)
    expect(isDocumentationPath('README.md\nunsafe')).toBe(false)
    expect(isDocumentationPath('../README.md')).toBe(false)
  })
})

describe('required context completion contract', () => {
  const qualityWorkflow = readFileSync('.github/workflows/quality.yml', 'utf8')
  const desktopWorkflow = readFileSync('.github/workflows/desktop-package.yml', 'utf8')
  const policyWorkflow = readFileSync('.github/workflows/pr-change-policy.yml', 'utf8')
  const workspaceCacheWarmWorkflow = readFileSync('.github/workflows/workspace-cache-warm.yml', 'utf8')
  const workspaceSetupAction = readFileSync('.github/actions/setup-workspace/action.yml', 'utf8')

  it('keeps PR and merge queue workflows unconditional so required contexts cannot remain pending', () => {
    const qualityTrigger = qualityWorkflow.slice(0, qualityWorkflow.indexOf('\npermissions:'))
    const desktopTrigger = desktopWorkflow.slice(
      desktopWorkflow.indexOf('\non:'),
      desktopWorkflow.indexOf('\npermissions:')
    )

    expect(qualityTrigger).not.toContain('paths:')
    expect(qualityTrigger).not.toContain('paths-ignore:')
    expect(qualityTrigger).not.toContain('\n  push:')
    expect(desktopTrigger).not.toContain('paths:')
    expect(desktopTrigger).not.toContain('paths-ignore:')
    for (const trigger of [qualityTrigger, desktopTrigger]) {
      expect(trigger).toContain('merge_group:')
      expect(trigger).toContain('- checks_requested')
    }
    expect(policyWorkflow.slice(0, policyWorkflow.indexOf('\npermissions:'))).toContain(
      'merge_group:'
    )
  })

  it('preserves every protected required context name', () => {
    for (
      const context of [
        'lint',
        'format-check',
        'typecheck',
        'commit-message'
      ]
    ) {
      expect(qualityWorkflow).toContain(`name: ${context}`)
    }
    expect(policyWorkflow).toContain('name: pr-change-policy')
    expect(desktopWorkflow).toContain('name: macOS installer')
  })

  it('reuses one classifier and provides lightweight success steps inside required jobs', () => {
    expect(qualityWorkflow).toContain('node scripts/pr-validation-scope.cjs')
    expect(qualityWorkflow).toContain('Validate changed documentation scope, privacy, links, anchors, and diff')
    expect(qualityWorkflow).toContain("needs.classify-changes.outputs.docs_changed == 'true'")
    expect(qualityWorkflow).toContain('Run affected typecheck scopes')
    expect(qualityWorkflow).toContain('Build affected client production bundle')
    expect(qualityWorkflow).toContain('pnpm -C apps/client exec vite build')
    expect(qualityWorkflow).toContain('outputs.client_build')
    expect(qualityWorkflow).toContain('TYPECHECK_SCOPES: $' + '{{ needs.classify-changes.outputs.typecheck_scopes }}')
    expect(qualityWorkflow).toContain("contains(env.TYPECHECK_SCOPES, 'node')")
    expect(qualityWorkflow).toContain('uses: dprint/check@v2.3')
    expect(qualityWorkflow).toContain("needs.classify-changes.result != 'success'")
    expect(qualityWorkflow).toContain("needs.classify-changes.outputs.typecheck == 'true'")
    expect(qualityWorkflow).toContain("needs.classify-changes.outputs.docs_media == 'true'")
    expect(qualityWorkflow).toContain('Validate classifier output contract')
    const typecheckSteps = qualityWorkflow.slice(
      qualityWorkflow.indexOf('      - name: Run affected typecheck scopes'),
      qualityWorkflow.indexOf('      - name: Run documentation media verification')
    )
    expect(typecheckSteps.match(/needs\.classify-changes\.result != 'success'/gu)).toHaveLength(2)
    expect(qualityWorkflow).toContain("env.RUN_CHECK != 'true'")
    expect(qualityWorkflow).not.toContain('FULL_VALIDATION')
    expect(desktopWorkflow).toContain('node scripts/pr-validation-scope.cjs')
    expect(desktopWorkflow).toContain('desktop_package: $' + '{{ steps.validation_scope.outputs.desktop_package }}')
    expect(desktopWorkflow).toContain('name: macOS package smoke')
    expect(desktopWorkflow).toContain('name: macOS installer')
    expect(desktopWorkflow).toContain('Enforce macOS package result')
    expect(desktopWorkflow).toContain('Validate classifier output contract')
    expect(desktopWorkflow).toContain("needs.pr-scope.outputs.desktop_package == 'true'")
  })

  it('keeps dependency-free checks out of workspace installation paths', () => {
    expect(policyWorkflow).toContain('node scripts/pr-change-check.cjs')
    expect(policyWorkflow).not.toContain('pnpm install')
    expect(policyWorkflow).not.toContain('git submodule update')

    const qualityJob = qualityWorkflow.slice(
      qualityWorkflow.indexOf('  quality:'),
      qualityWorkflow.indexOf('  public-docs:')
    )
    expect(qualityJob).toContain("if: env.NEEDS_DEPENDENCIES == 'true'")
    expect(qualityJob).toContain("env.RUN_CHECK == 'true' ||")
    expect(qualityJob).toContain(
      "matrix.name == 'lint' && needs.classify-changes.outputs.docs_changed == 'true'"
    )
    expect(qualityJob).toContain('run: node scripts/check-env-contract.mjs')
    expect(qualityJob).toContain('uses: dprint/check@v2.3')
    expect(qualityJob).toContain('if command -v ffmpeg >/dev/null 2>&1; then')
  })

  it('reruns base edits without letting metadata edits cancel source validation', () => {
    const qualityTrigger = qualityWorkflow.slice(0, qualityWorkflow.indexOf('\npermissions:'))
    const desktopTrigger = desktopWorkflow.slice(
      desktopWorkflow.indexOf('\non:'),
      desktopWorkflow.indexOf('\npermissions:')
    )
    const policyTrigger = policyWorkflow.slice(0, policyWorkflow.indexOf('\npermissions:'))

    expect(qualityTrigger).toContain('- edited')
    expect(desktopTrigger).toContain('- edited')
    expect(policyTrigger).toContain('- edited')
    expect(qualityWorkflow).toContain('github.event.changes.base != null')
    expect(desktopWorkflow).toContain('github.event.changes.base != null')
    const sourceCancellation = 'cancel-in-progress: $' +
      "{{ github.event_name == 'pull_request' || github.event_name == 'merge_group' }}"
    expect(qualityWorkflow).toContain(sourceCancellation)
    expect(desktopWorkflow).toContain(sourceCancellation)
    expect(qualityWorkflow).toContain('Restore exact source validation evidence')
    expect(desktopWorkflow).toContain('Restore previous desktop validation evidence')
    expect(qualityWorkflow).toContain('pr-quality-evidence-v1-')
    expect(desktopWorkflow).toContain('pr-desktop-evidence-v1-')
    expect(policyWorkflow).toContain(
      'group: pr-change-policy-$' +
        '{{ github.event_name }}-' +
        '$' +
        '{{ github.event.pull_request.number || github.ref }}'
    )
  })

  it('validates the generated merge group revision without reusing PR-head evidence', () => {
    expect(qualityWorkflow).toContain('github.event.merge_group.base_sha')
    expect(qualityWorkflow).toContain('github.event.merge_group.head_sha')
    expect(desktopWorkflow).toContain('github.event.merge_group.base_sha')
    expect(desktopWorkflow).toContain('github.event.merge_group.head_sha')
    expect(qualityWorkflow).toContain(
      'if [[ "$EVENT_NAME" == "pull_request" || "$EVENT_NAME" == "merge_group" ]]; then'
    )
    expect(qualityWorkflow).toContain('Confirm queued commit policy')
    expect(policyWorkflow).toContain('Confirm queued pull request policy')
    expect(desktopWorkflow).toContain('--event-name "$EVENT_NAME"')

    const desktopGate = desktopWorkflow.slice(
      desktopWorkflow.indexOf('  pr-policy:'),
      desktopWorkflow.indexOf('  dispatch-policy:')
    )
    const releasePackage = desktopWorkflow.slice(
      desktopWorkflow.indexOf('  package:'),
      desktopWorkflow.indexOf('  release:')
    )
    expect(desktopGate).toContain("github.event_name == 'merge_group'")
    expect(desktopGate).toContain("github.event_name == 'pull_request' &&")
    expect(releasePackage).toContain("github.event_name != 'merge_group'")
  })

  it('shares exact dependency and incremental caches without weakening required contexts', () => {
    const reuseJob = qualityWorkflow.slice(
      qualityWorkflow.indexOf('  validation-reuse:'),
      qualityWorkflow.indexOf('  quality:')
    )
    const desktopScopeJob = desktopWorkflow.slice(
      desktopWorkflow.indexOf('  pr-scope:'),
      desktopWorkflow.indexOf('  pr-build:')
    )

    expect(workspaceSetupAction).toContain('uses: actions/cache@v4')
    expect(workspaceSetupAction).toContain('workspace-v1-')
    expect(workspaceSetupAction).toContain('runner.arch')
    expect(workspaceSetupAction).toContain("'.github/actions/setup-workspace/action.yml'")
    expect(workspaceSetupAction).toContain("'patches/**/*.patch'")
    expect(workspaceSetupAction).toContain("if: steps.workspace-cache.outputs.cache-hit != 'true'")
    expect(workspaceSetupAction).toContain('run: pnpm install --frozen-lockfile')
    expect(workspaceSetupAction).toContain('name: Setup Node.js from exact workspace cache')
    expect(workspaceSetupAction).toContain('name: Setup Node.js with pnpm store cache')
    expect(workspaceSetupAction.indexOf('name: Restore workspace dependencies')).toBeLessThan(
      workspaceSetupAction.indexOf('name: Setup pnpm')
    )
    expect(workspaceSetupAction).toContain(
      "if: steps.workspace-cache.outputs.cache-hit == 'true'\n      uses: actions/setup-node@v4"
    )
    const cacheWarmTrigger = workspaceCacheWarmWorkflow.slice(
      0,
      workspaceCacheWarmWorkflow.indexOf('\npermissions:')
    )
    const hashFilesArguments = workspaceSetupAction.match(/hashFiles\(([\s\S]*?)\)/u)?.[1]
    expect(hashFilesArguments).toBeDefined()
    const cacheAuthorities = new Set(
      Array.from(hashFilesArguments!.matchAll(/'([^']+)'/gu), match => match[1]!)
    )
    const cacheWarmPaths = new Set(
      Array.from(
        cacheWarmTrigger
          .slice(cacheWarmTrigger.indexOf('    paths:\n'), cacheWarmTrigger.indexOf('  workflow_dispatch:\n'))
          .matchAll(/^ {6}- (.+)$/gmu),
        match => match[1]!
      )
    )
    expect(cacheWarmPaths).toEqual(
      new Set([
        ...cacheAuthorities,
        '.github/workflows/workspace-cache-warm.yml'
      ])
    )
    expect(cacheWarmTrigger).toContain('  push:\n')
    expect(cacheWarmTrigger).toContain('      - main\n')
    expect(cacheWarmTrigger).toContain('  workflow_dispatch:\n')
    expect(cacheWarmTrigger).not.toContain('pull_request')
    expect(cacheWarmTrigger).not.toContain('merge_group')
    expect(cacheWarmTrigger).toContain('      - .github/actions/setup-workspace/action.yml\n')
    expect(cacheWarmTrigger).toContain('      - .github/workflows/workspace-cache-warm.yml\n')
    expect(workspaceCacheWarmWorkflow).toContain('          - ubuntu-latest\n')
    expect(workspaceCacheWarmWorkflow).toContain('          - macos-26\n')
    expect(workspaceCacheWarmWorkflow).toContain('uses: ./.github/actions/setup-workspace')
    expect(qualityWorkflow).toContain('uses: ./.github/actions/setup-workspace')
    expect(desktopWorkflow).toContain('uses: ./.github/actions/setup-workspace')
    expect(qualityWorkflow).toContain('--cache-location .cache/eslint/.eslintcache')
    expect(qualityWorkflow).toContain('ONEWORKS_TYPECHECK_CACHE_DIR: .cache/typecheck')
    expect(qualityWorkflow).toContain('pr-typecheck-evidence-v1-')
    expect(qualityWorkflow).toContain('Verify ESLint autofix-only revision')
    expect(qualityWorkflow).toContain('Validate previous typecheck evidence')
    expect(qualityWorkflow).toContain('cat .cache/pr-validation-evidence/typecheck/revision')
    expect(qualityWorkflow).toContain('needs.validation-reuse.outputs.typecheck')
    expect(desktopWorkflow).toContain('Validate previous desktop validation evidence')
    expect(desktopWorkflow).toContain('cat .cache/pr-validation-evidence/desktop/revision')
    expect(reuseJob).toContain('Checkout pull request merge')
    expect(reuseJob).toContain("needs.classify-changes.outputs.reuse_mode == 'eslint-autofix'")
    expect(reuseJob).toContain("needs.classify-changes.outputs.reuse_candidate == 'true'")
    expect(reuseJob).not.toContain('ref: ${{ github.event.pull_request.head.sha')
    expect(desktopScopeJob).toContain('Checkout pull request merge')
    expect(desktopScopeJob).not.toContain('ref: ${{ github.event.pull_request.head.sha')
  })

  it('adds only the relevant public and release documentation gates', () => {
    expect(qualityWorkflow).toContain('name: public-docs-build')
    expect(qualityWorkflow).toContain('package_json_file: assets/homepage/package.json')
    expect(qualityWorkflow).toContain('pnpm -C assets/homepage build:docs')
    expect(qualityWorkflow).toContain('name: release-docs-preflight')
    expect(qualityWorkflow).toContain('--release-preflight')

    const publicDocsJob = qualityWorkflow.slice(
      qualityWorkflow.indexOf('  public-docs:'),
      qualityWorkflow.indexOf('  release-docs:')
    )
    const releaseDocsJob = qualityWorkflow.slice(
      qualityWorkflow.indexOf('  release-docs:'),
      qualityWorkflow.indexOf('  commit-message:')
    )
    expect(publicDocsJob).not.toContain('outputs.docs_only')
    expect(publicDocsJob).not.toContain('version: 11.7.0')
    expect(publicDocsJob).not.toContain('version: 10.33.0')
    expect(publicDocsJob).toContain('package_json_file: assets/homepage/package.json')
    expect(publicDocsJob).not.toContain('cache: pnpm')
    expect(publicDocsJob).not.toContain('cache-dependency-path:')
    expect(releaseDocsJob).not.toContain('outputs.docs_only')
    expect(releaseDocsJob).toContain('--allow-mixed')
  })
})
