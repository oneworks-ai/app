import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { evaluatePrChangePolicy } from '../pr-change-policy'
import {
  classifyChangedPaths,
  classifyPrValidationRange,
  isDocumentationPath,
  prValidationScopeVersion
} from '../pr-validation-scope.cjs'

const runGit = (cwd: string, args: string[]) =>
  execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  }).trim()

const shouldRunFullValidation = (classifierResult: string, docsOnly: string | undefined) =>
  classifierResult !== 'success' || docsOnly !== 'true'

describe('pr validation scope', () => {
  it('classifies ordinary Markdown and internal module rules as docs-only', () => {
    const scope = classifyChangedPaths([
      'apps/client/AGENTS.md',
      '.oo/rules/architecture/dependencies.md'
    ])

    expect(scope).toMatchObject({
      docsChanged: true,
      docsOnly: true,
      full: false,
      policyDocs: false,
      publicDocs: false,
      releaseDocs: false,
      version: prValidationScopeVersion
    })
    expect(scope.nonDocsFiles).toEqual([])
  })

  it('adds public-doc validation for root READMEs and .oo/docs media', () => {
    const scope = classifyChangedPaths([
      'README.md',
      '.oo/docs/usage/install.md',
      '.oo/docs/images/install.png'
    ])

    expect(scope).toMatchObject({
      docsChanged: true,
      docsOnly: true,
      full: false,
      publicDocs: true
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
    expect(classifyChangedPaths([])).toMatchObject({ docsOnly: false, full: true })
    expect(classifyChangedPaths(['README.md'], { forceFull: true })).toMatchObject({
      docsOnly: false,
      full: true
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

  it('keeps PR workflows unconditional so required contexts cannot remain pending', () => {
    const qualityTrigger = qualityWorkflow.slice(0, qualityWorkflow.indexOf('\npermissions:'))
    const desktopTrigger = desktopWorkflow.slice(
      desktopWorkflow.indexOf('\non:'),
      desktopWorkflow.indexOf('\npermissions:')
    )

    expect(qualityTrigger).not.toContain('paths:')
    expect(qualityTrigger).not.toContain('paths-ignore:')
    expect(desktopTrigger).not.toContain('paths:')
    expect(desktopTrigger).not.toContain('paths-ignore:')
  })

  it('preserves every protected required context name', () => {
    for (
      const context of [
        'lint',
        'format-check',
        'typecheck',
        'commit-message',
        'pr-change-policy'
      ]
    ) {
      expect(qualityWorkflow).toContain(`name: ${context}`)
    }
    expect(desktopWorkflow).toContain('name: macOS installer')
  })

  it('reuses one classifier and provides lightweight success steps inside required jobs', () => {
    expect(qualityWorkflow).toContain('node scripts/pr-validation-scope.cjs')
    expect(qualityWorkflow).toContain('Validate changed documentation scope, privacy, links, anchors, and diff')
    expect(qualityWorkflow).toContain("needs.classify-changes.outputs.docs_changed == 'true'")
    expect(qualityWorkflow).toContain('Check docs-only formatting')
    expect(qualityWorkflow).toContain('Confirm docs-only typecheck scope')
    expect(qualityWorkflow).toContain("needs.classify-changes.result != 'success'")
    expect(qualityWorkflow).toContain("needs.classify-changes.outputs.docs_only != 'true'")
    expect(qualityWorkflow).toContain('Validate classifier output contract')
    expect(qualityWorkflow).toContain("if: env.FULL_VALIDATION == 'true'")
    expect(desktopWorkflow).toContain('node scripts/pr-validation-scope.cjs')
    expect(desktopWorkflow).toContain('Confirm docs-only installer exclusion')
    expect(desktopWorkflow).toContain('Validate classifier output contract')
    expect(desktopWorkflow).toContain("if: steps.validation_scope.outputs.docs_only != 'true'")
    expect(desktopWorkflow).not.toContain("if: steps.validation_scope.outputs.full == 'true'")
  })

  it.each([
    ['missing', undefined],
    ['empty', ''],
    ['malformed', 'TRUE'],
    ['full', 'false']
  ])('fails a successful classifier with %s docs_only output closed to full validation', (_label, docsOnly) => {
    expect(shouldRunFullValidation('success', docsOnly)).toBe(true)
  })

  it('adds only the relevant public and release documentation gates', () => {
    expect(qualityWorkflow).toContain('name: public-docs-build')
    expect(qualityWorkflow).toContain("require('./assets/homepage/package.json').packageManager")
    expect(qualityWorkflow).toContain('-C assets/homepage build:docs')
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
    expect(publicDocsJob).toContain('version: 11.7.0')
    expect(publicDocsJob).not.toContain('version: 10.33.0')
    expect(publicDocsJob).not.toContain('run: pnpm -C assets/homepage')
    expect(releaseDocsJob).not.toContain('outputs.docs_only')
    expect(releaseDocsJob).toContain('--allow-mixed')
  })
})
