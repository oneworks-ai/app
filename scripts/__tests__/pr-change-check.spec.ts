import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { evaluatePrChangePolicy } from '../pr-change-check'

const experienceReviewBody = [
  '## Experience Review',
  '- [x] 已判断是否需要沉淀经验',
  '- [x] 如需要，已运行 `$post-task-experience-review`',
  '- [x] reviewer PASS 后才进入 merge'
].join('\n')

const policyConflictReviewBody = [
  experienceReviewBody,
  '',
  '## Policy Conflict Review',
  '- [x] Independent read-only reviewer checked workflow, permission, and release-rule conflicts and reported PASS'
].join('\n')

describe('pr-change-check', () => {
  it('does not require changelog for documentation content source changes', () => {
    const result = evaluatePrChangePolicy({
      changedFiles: ['README.md', '.oo/docs/usage/install.md'],
      commitSubjects: ['docs: update install notes'],
      prBody: experienceReviewBody
    })

    expect(result.violations).toEqual([])
    expect(result.requiresChangelog).toBe(false)
  })

  it('requires an independent conflict review for permission and release-rule docs', () => {
    const missingReview = evaluatePrChangePolicy({
      changedFiles: ['.oo/rules/maintenance/task-planning.md'],
      commitSubjects: ['docs: clarify Git operator permissions'],
      prBody: experienceReviewBody
    })

    expect(missingReview.requiresPolicyConflictReview).toBe(true)
    expect(missingReview.violations).toContain(
      'Workflow, permission, and release-rule documentation changes require a completed ## Policy Conflict Review checklist recording an independent read-only reviewer PASS.'
    )

    const reviewed = evaluatePrChangePolicy({
      changedFiles: ['.oo/rules/release/process.md'],
      commitSubjects: ['docs: clarify release approval'],
      prBody: policyConflictReviewBody
    })

    expect(reviewed.hasPolicyConflictReview).toBe(true)
    expect(reviewed.violations).toEqual([])
  })

  it('does not require policy conflict evidence for ordinary module guidance', () => {
    const result = evaluatePrChangePolicy({
      changedFiles: ['apps/client/AGENTS.md'],
      commitSubjects: ['docs: clarify client ownership'],
      prBody: experienceReviewBody
    })

    expect(result.requiresPolicyConflictReview).toBe(false)
    expect(result.violations).toEqual([])
  })

  it('does not require changelog for homepage docs shell changes', () => {
    const result = evaluatePrChangePolicy({
      changedFiles: ['assets/homepage/apps/docs/.vitepress/config.mts'],
      commitSubjects: ['docs: update docs shell navigation'],
      prBody: experienceReviewBody
    })

    expect(result.violations).toEqual([])
    expect(result.requiresChangelog).toBe(false)
  })

  it('requires changelog for feature product changes', () => {
    const result = evaluatePrChangePolicy({
      changedFiles: ['apps/server/src/routes/module-updates.ts'],
      commitSubjects: ['feat: add module update checks'],
      prBody: experienceReviewBody
    })

    expect(result.requiresChangelog).toBe(true)
    expect(result.violations).toContain(
      'Feature/fix PRs that change product code must update changelog/<version>/<package>.md or readme.md.'
    )
  })

  it('accepts feature product changes with changelog', () => {
    const result = evaluatePrChangePolicy({
      changedFiles: [
        'apps/server/src/routes/module-updates.ts',
        'changelog/4.0.0-alpha/readme.md'
      ],
      commitSubjects: ['feat: add module update checks'],
      prBody: experienceReviewBody
    })

    expect(result.violations).toEqual([])
  })

  it('does not count a deleted changelog entry as present', () => {
    const result = evaluatePrChangePolicy({
      changedPathEntries: [
        { paths: ['apps/server/src/index.ts'], status: 'M' },
        { paths: ['changelog/1.2.3/server.md'], status: 'D' }
      ],
      changedFiles: ['apps/server/src/index.ts', 'changelog/1.2.3/server.md'],
      commitSubjects: ['fix: remove obsolete runtime behavior'],
      prBody: experienceReviewBody
    })

    expect(result.hasChangelog).toBe(false)
    expect(result.violations).toContain(
      'Feature/fix PRs that change product code must update changelog/<version>/<package>.md or readme.md.'
    )
  })

  it('counts only the live destination of a changelog rename', () => {
    const movedOut = evaluatePrChangePolicy({
      changedPathEntries: [
        { paths: ['apps/server/src/index.ts'], status: 'M' },
        { paths: ['changelog/1.2.3/server.md', 'docs/server-history.md'], status: 'R100' }
      ],
      changedFiles: [
        'apps/server/src/index.ts',
        'changelog/1.2.3/server.md',
        'docs/server-history.md'
      ],
      commitSubjects: ['feat: update server behavior'],
      prBody: experienceReviewBody
    })
    expect(movedOut.hasChangelog).toBe(false)

    const renamedInPlace = evaluatePrChangePolicy({
      changedPathEntries: [
        { paths: ['apps/server/src/index.ts'], status: 'M' },
        {
          paths: ['changelog/1.2.3/server.md', 'changelog/1.2.3/readme.md'],
          status: 'R100'
        }
      ],
      changedFiles: [
        'apps/server/src/index.ts',
        'changelog/1.2.3/server.md',
        'changelog/1.2.3/readme.md'
      ],
      commitSubjects: ['feat: update server behavior'],
      prBody: experienceReviewBody
    })
    expect(renamedInPlace.hasChangelog).toBe(true)
    expect(renamedInPlace.violations).toEqual([])
  })

  it('requires screenshots for UI feature changes', () => {
    const result = evaluatePrChangePolicy({
      changedFiles: [
        'apps/client/src/components/module-updates/ModuleManagementView.tsx',
        'changelog/4.0.0-alpha/client.md'
      ],
      commitSubjects: ['feat: add module update management'],
      prBody: experienceReviewBody
    })

    expect(result.requiresScreenshot).toBe(true)
    expect(result.violations).toContain(
      'Feature/fix PRs that change UI surfaces must include a screenshot in the PR body.'
    )
  })

  it('accepts UI feature changes with screenshot evidence', () => {
    const result = evaluatePrChangePolicy({
      changedFiles: [
        'apps/client/src/components/module-updates/ModuleManagementView.tsx',
        'changelog/4.0.0-alpha/client.md'
      ],
      commitSubjects: ['feat: add module update management'],
      prBody: [
        '## Screenshots',
        '![module updates](https://github.com/user-attachments/assets/123)',
        '',
        experienceReviewBody
      ].join('\n')
    })

    expect(result.violations).toEqual([])
  })

  it('keeps the PR template actionable without treating its guidance as screenshot evidence', () => {
    const result = evaluatePrChangePolicy({
      changedFiles: [
        'apps/client/src/components/module-updates/ModuleManagementView.tsx',
        'changelog/4.0.0-alpha/client.md'
      ],
      commitSubjects: ['feat: add module update management'],
      prBody: readFileSync('.github/pull_request_template.md', 'utf8')
    })

    expect(result.hasChangelog).toBe(true)
    expect(result.hasScreenshot).toBe(false)
    expect(result.violations).toContain(
      'Feature/fix PRs that change UI surfaces must include a screenshot in the PR body.'
    )
  })

  it('does not treat module guidance under UI source folders as a UI surface', () => {
    const result = evaluatePrChangePolicy({
      changedFiles: [
        'apps/android/scripts/launch-visible-emulator.mjs',
        'apps/client/src/components/chat/interaction-panel/AGENTS.md',
        'changelog/4.0.0-alpha/readme.md'
      ],
      commitSubjects: ['feat: coordinate development services'],
      prBody: experienceReviewBody
    })

    expect(result.requiresScreenshot).toBe(false)
    expect(result.violations).toEqual([])
  })

  it('does not require changelog for tooling upgrades', () => {
    const result = evaluatePrChangePolicy({
      changedFiles: ['pnpm-lock.yaml', '.github/workflows/quality.yml'],
      commitSubjects: ['chore: upgrade toolchain'],
      prBody: experienceReviewBody
    })

    expect(result.violations).toEqual([])
  })

  it('requires the experience review checklist in the PR body', () => {
    const result = evaluatePrChangePolicy({
      changedFiles: ['scripts/pr-change-check.ts'],
      commitSubjects: ['chore: update PR policy'],
      prBody: [
        '## Experience Review',
        '- [x] 已判断是否需要沉淀经验',
        '- [ ] 如需要，已运行 `$post-task-experience-review`',
        '- [x] reviewer PASS 后才进入 merge'
      ].join('\n')
    })

    expect(result.hasExperienceReview).toBe(false)
    expect(result.violations).toContain(
      'PR body must include a completed ## Experience Review checklist confirming experience judgment, $post-task-experience-review when needed, and reviewer PASS before merge.'
    )
  })

  it('accepts the completed experience review checklist before later sections', () => {
    const result = evaluatePrChangePolicy({
      changedFiles: ['scripts/pr-change-check.ts'],
      commitSubjects: ['chore: update PR policy'],
      prBody: [
        experienceReviewBody,
        '',
        '## Validation',
        '- pnpm test'
      ].join('\n')
    })

    expect(result.hasExperienceReview).toBe(true)
    expect(result.violations).toEqual([])
  })

  it('reruns only the PR policy job on PR body edits', () => {
    const qualityWorkflow = readFileSync('.github/workflows/quality.yml', 'utf8')

    expect(qualityWorkflow).toContain('      - edited')
    expect(qualityWorkflow).toContain('  pr-change-policy:')
    expect(qualityWorkflow).toContain('    name: pr-change-policy')
    expect(qualityWorkflow.match(/github\.event\.action != 'edited'/gu)).toHaveLength(3)
    expect(qualityWorkflow).toContain('PR_BODY: $' + '{{ github.event.pull_request.body }}')
    expect(qualityWorkflow).not.toContain('gh pr view')
  })

  it('gets policy paths from the authoritative rename- and deletion-aware classifier', () => {
    const policyCheck = readFileSync('scripts/pr-change-check.ts', 'utf8')

    expect(policyCheck).toContain('getChangedFilesFromEntries')
    expect(policyCheck).toContain('getChangedPathEntries')
    expect(policyCheck).toContain('changedPathEntries,')
    expect(policyCheck).not.toContain('--diff-filter=ACMRT')
  })
})
