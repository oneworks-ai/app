import { describe, expect, it } from 'vitest'

import { evaluatePrChangePolicy } from '../pr-change-check'

describe('pr-change-check', () => {
  it('does not require changelog for documentation content source changes', () => {
    const result = evaluatePrChangePolicy({
      changedFiles: ['README.md', '.oo/docs/usage/install.md'],
      commitSubjects: ['docs: update install notes']
    })

    expect(result.violations).toEqual([])
    expect(result.requiresChangelog).toBe(false)
  })

  it('does not require changelog for homepage docs shell changes', () => {
    const result = evaluatePrChangePolicy({
      changedFiles: ['assets/homepage/apps/docs/.vitepress/config.mts'],
      commitSubjects: ['docs: update docs shell navigation']
    })

    expect(result.violations).toEqual([])
    expect(result.requiresChangelog).toBe(false)
  })

  it('requires changelog for feature product changes', () => {
    const result = evaluatePrChangePolicy({
      changedFiles: ['apps/server/src/routes/module-updates.ts'],
      commitSubjects: ['feat: add module update checks']
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
      commitSubjects: ['feat: add module update checks']
    })

    expect(result.violations).toEqual([])
  })

  it('requires screenshots for UI feature changes', () => {
    const result = evaluatePrChangePolicy({
      changedFiles: [
        'apps/client/src/components/module-updates/ModuleManagementView.tsx',
        'changelog/4.0.0-alpha/client.md'
      ],
      commitSubjects: ['feat: add module update management']
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
      prBody: '## Screenshots\n![module updates](https://github.com/user-attachments/assets/123)'
    })

    expect(result.violations).toEqual([])
  })

  it('does not require changelog for tooling upgrades', () => {
    const result = evaluatePrChangePolicy({
      changedFiles: ['pnpm-lock.yaml', '.github/workflows/quality.yml'],
      commitSubjects: ['chore: upgrade toolchain']
    })

    expect(result.violations).toEqual([])
  })
})
