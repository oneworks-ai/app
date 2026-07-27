import process from 'node:process'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { runPrPreflight } from '../pr-preflight'

const checkMocks = vi.hoisted(() => ({
  getWorkingTreeChanges: vi.fn(),
  inspectPrChange: vi.fn()
}))

vi.mock('../pr-change-check', () => checkMocks)

const successfulInspection = {
  base: 'origin/main',
  changedFiles: ['scripts/pr-preflight.ts'],
  commitSubjects: ['chore: add PR preflight'],
  head: 'HEAD',
  result: {
    hasChangelog: false,
    hasExperienceReview: true,
    hasScreenshot: false,
    requiresChangelog: false,
    requiresScreenshot: false,
    violations: []
  }
}

describe('pr-preflight', () => {
  beforeEach(() => {
    checkMocks.inspectPrChange.mockReturnValue(successfulInspection)
    checkMocks.getWorkingTreeChanges.mockReturnValue([])
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    process.exitCode = undefined
  })

  afterEach(() => {
    vi.restoreAllMocks()
    process.exitCode = undefined
    vi.clearAllMocks()
  })

  it('defaults to origin/main and emits a successful JSON result', async () => {
    const input = {
      bodyFile: '.logs/pr-body.md',
      json: true
    }

    await runPrPreflight(input)

    const stdoutWrite = vi.mocked(process.stdout.write)
    expect(checkMocks.inspectPrChange).toHaveBeenCalledWith(input, 'origin/main')
    expect(JSON.parse(String(stdoutWrite.mock.calls[0]?.[0]))).toMatchObject({
      base: 'origin/main',
      head: 'HEAD',
      ok: true,
      violations: [],
      workingTreeChanges: []
    })
    expect(process.exitCode).toBeUndefined()
  })

  it('rejects a dirty working tree with a machine-readable violation', async () => {
    checkMocks.getWorkingTreeChanges.mockReturnValue([' M scripts/pr-preflight.ts'])

    await runPrPreflight({
      bodyFile: '.logs/pr-body.md',
      json: true
    })

    const stdoutWrite = vi.mocked(process.stdout.write)
    expect(JSON.parse(String(stdoutWrite.mock.calls[0]?.[0]))).toMatchObject({
      ok: false,
      violations: [
        'Working tree must be clean so preflight evaluates the exact commits that will be pushed.'
      ],
      workingTreeChanges: [' M scripts/pr-preflight.ts']
    })
    expect(process.exitCode).toBe(1)
  })

  it('preserves policy violations and returns a failing exit code', async () => {
    checkMocks.inspectPrChange.mockReturnValue({
      ...successfulInspection,
      result: {
        ...successfulInspection.result,
        hasExperienceReview: false,
        violations: ['Experience Review is incomplete.']
      }
    })

    await runPrPreflight({
      bodyFile: '.logs/pr-body.md',
      json: true
    })

    const stdoutWrite = vi.mocked(process.stdout.write)
    expect(JSON.parse(String(stdoutWrite.mock.calls[0]?.[0]))).toMatchObject({
      ok: false,
      violations: ['Experience Review is incomplete.']
    })
    expect(process.exitCode).toBe(1)
  })
})
