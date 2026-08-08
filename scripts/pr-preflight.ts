import process from 'node:process'

import { getWorkingTreeChanges, inspectPrChange } from './pr-change-check'
import type { RunPrChangeCheckInput } from './pr-change-check'

export interface RunPrPreflightInput extends RunPrChangeCheckInput {
  json?: boolean
}

export const runPrPreflight = async (input: RunPrPreflightInput) => {
  const inspection = inspectPrChange(input, 'origin/main')
  const workingTreeChanges = getWorkingTreeChanges()
  const violations = [...inspection.result.violations]
  if (workingTreeChanges.length > 0) {
    violations.push(
      'Working tree must be clean so preflight evaluates the exact commits that will be pushed.'
    )
  }
  const output = {
    ok: violations.length === 0,
    base: inspection.base,
    head: inspection.head,
    changedFiles: inspection.changedFiles,
    commitSubjects: inspection.commitSubjects,
    ...inspection.result,
    violations,
    workingTreeChanges
  }

  if (input.json === true) {
    process.stdout.write(`${JSON.stringify(output, null, 2)}\n`)
  } else if (output.ok) {
    console.log('[pr-preflight] ok')
    console.log(`- changelog: ${output.requiresChangelog ? 'required and present' : 'not required'}`)
    console.log(`- screenshot: ${output.requiresScreenshot ? 'required and present' : 'not required'}`)
    console.log(
      `- policy conflict review: ${output.requiresPolicyConflictReview ? 'required and present' : 'not required'}`
    )
    console.log('- experience review: complete')
  } else {
    console.error('[pr-preflight] failed')
    for (const violation of output.violations) {
      console.error(`- ${violation}`)
    }
    console.error(
      '- Prepare .logs/pr-body.md from .github/pull_request_template.md, then rerun with --body-file .logs/pr-body.md.'
    )
  }

  if (!output.ok) {
    process.exitCode = 1
  }
}
