#!/usr/bin/env node

const { execFileSync } = require('node:child_process')
const { readFileSync } = require('node:fs')
const process = require('node:process')

const { evaluatePrChangePolicy } = require('./pr-change-policy.cjs')
const {
  getChangedFilesFromEntries,
  getChangedPathEntries
} = require('./pr-validation-scope.cjs')

const runGit = (args) => (
  execFileSync('git', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  }).trim()
)

const splitLines = (value) => value.split('\n').map(line => line.trim()).filter(Boolean)

const normalizeRef = (value) => {
  const ref = value?.trim()
  return ref == null || ref === '' || /^0+$/u.test(ref) ? undefined : ref
}

const readPrBody = (input) => {
  if (input.bodyFile != null && input.bodyFile.trim() !== '') {
    return readFileSync(input.bodyFile, 'utf8')
  }
  return input.body
}

const getCommitSubjects = (base, head) => (
  splitLines(runGit(['log', '--format=%s', base == null ? head : `${base}..${head}`]))
)

const getWorkingTreeChanges = () => splitLines(runGit(['status', '--porcelain']))

const inspectPrChange = (input, defaultBase) => {
  const head = normalizeRef(input.head) ?? 'HEAD'
  const base = normalizeRef(input.base) ?? defaultBase
  const changedPathEntries = getChangedPathEntries({ base, head })
  const changedFiles = getChangedFilesFromEntries(changedPathEntries)
  const commitSubjects = getCommitSubjects(base, head)
  const result = evaluatePrChangePolicy({
    changedPathEntries,
    changedFiles,
    commitSubjects,
    prBody: readPrBody(input)
  })

  return {
    base,
    changedPathEntries,
    changedFiles,
    commitSubjects,
    head,
    result
  }
}

const runPrChangeCheck = (input) => {
  const { result } = inspectPrChange(input)

  if (result.violations.length === 0) {
    console.log('[pr-change-check] ok')
    return
  }

  console.error('[pr-change-check] failed')
  for (const violation of result.violations) {
    console.error(`- ${violation}`)
  }
  process.exitCode = 1
}

const parseArguments = (args) => {
  const input = {}
  const positional = []

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]
    if (argument === '--body') input.body = args[++index] ?? ''
    else if (argument === '--body-file') input.bodyFile = args[++index] ?? ''
    else if (argument.startsWith('-')) throw new Error(`Unknown pr-change-check argument: ${argument}`)
    else positional.push(argument)
  }

  if (positional.length > 2) throw new Error('pr-change-check accepts at most base and head revisions.')
  input.base = positional[0]
  input.head = positional[1]
  return input
}

module.exports = {
  getWorkingTreeChanges,
  inspectPrChange,
  runPrChangeCheck
}

if (require.main === module) {
  try {
    runPrChangeCheck(parseArguments(process.argv.slice(2)))
  } catch (error) {
    process.stderr.write(`[pr-change-check] ${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  }
}
