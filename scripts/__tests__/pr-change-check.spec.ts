import { describe, expect, it } from 'vitest'

import { evaluatePrChangePolicy } from '../pr-change-check'

const experienceReviewBody = [
  '## Experience Review',
  '- [x] 已判断是否需要沉淀经验',
  '- [x] 如需要，已运行 `$post-task-experience-review`',
  '- [x] reviewer PASS 后才进入 merge'
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
})
