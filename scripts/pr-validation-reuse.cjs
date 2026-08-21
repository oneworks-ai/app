#!/usr/bin/env node

/* eslint-disable max-lines -- Reuse planning, verification, and dependency-free CLI output form one fail-closed contract. */

const { Buffer } = require('node:buffer')
const { execFileSync, spawnSync } = require('node:child_process')
const { appendFileSync } = require('node:fs')
const process = require('node:process')
const { TextDecoder } = require('node:util')

const { getChangedPathEntriesBetweenTrees } = require('./pr-validation-scope.cjs')

const prValidationReuseVersion = 1
const gitCommitPattern = /^[0-9a-f]{40}$/iu
const reusableSourcePathPattern =
  /^(?:apps\/[^/]+\/(?:src|__tests__)\/|packages\/(?:adapters|channels|plugins)\/[^/]+\/(?:src|__tests__)\/|packages\/[^/]+\/(?:src|__tests__)\/).+\.(?:cjs|cts|js|jsx|mjs|mts|ts|tsx)$/iu
const maximumAutofixFiles = 20
const regularBlobModes = new Set(['100644', '100755'])

const isCommit = value => gitCommitPattern.test(value ?? '')

const parseRawDiff = (output) => {
  const parts = output.toString('utf8').split('\0').filter(Boolean)
  const changes = []

  for (let index = 0; index < parts.length;) {
    const header = parts[index++]
    const match = /^:(\d{6}) (\d{6}) [0-9a-f]{40} [0-9a-f]{40} ([A-Z]\d*)$/u.exec(header)
    if (match == null) return null
    const status = match[3]
    const pathCount = status.startsWith('R') || status.startsWith('C') ? 2 : 1
    if (index + pathCount > parts.length) return null
    index += pathCount
    changes.push({ newMode: match[2], oldMode: match[1], status })
  }

  return changes
}

const classifyAutofixCandidate = ({ before, cwd = process.cwd(), head }) => {
  if (!isCommit(before) || !isCommit(head) || before === head) {
    return { candidate: false, changes: [], reason: 'invalid-revision-range' }
  }

  let changes
  let rawChanges
  let summary
  try {
    changes = getChangedPathEntriesBetweenTrees({ before, cwd, head })
    rawChanges = parseRawDiff(execFileSync(
      'git',
      ['diff', '--raw', '--no-abbrev', '-z', before, head, '--'],
      {
        cwd,
        maxBuffer: 1024 * 1024 * 20,
        stdio: ['ignore', 'pipe', 'pipe']
      }
    ))
    summary = execFileSync('git', ['diff', '--summary', before, head, '--'], {
      cwd,
      maxBuffer: 1024 * 1024 * 20,
      stdio: ['ignore', 'pipe', 'pipe']
    })
  } catch {
    return { candidate: false, changes: [], reason: 'revision-diff-failed' }
  }

  if (changes.length === 0) return { candidate: false, changes, reason: 'empty-revision-delta' }
  if (changes.length > maximumAutofixFiles) {
    return { candidate: false, changes, reason: 'revision-delta-too-large' }
  }
  if (rawChanges == null || rawChanges.length !== changes.length) {
    return { candidate: false, changes, reason: 'raw-diff-invalid' }
  }

  for (const change of changes) {
    if (change.status !== 'M' || change.paths.length !== 1) {
      return { candidate: false, changes, reason: 'non-modification-change' }
    }
    if (!reusableSourcePathPattern.test(change.paths[0])) {
      return { candidate: false, changes, reason: 'non-reusable-source-path' }
    }
  }

  if (summary.length > 0) {
    return { candidate: false, changes, reason: 'file-mode-changed' }
  }
  if (rawChanges.some(change => change.oldMode !== change.newMode)) {
    return { candidate: false, changes, reason: 'file-mode-changed' }
  }
  if (
    rawChanges.some(change => !regularBlobModes.has(change.oldMode) || !regularBlobModes.has(change.newMode))
  ) {
    return { candidate: false, changes, reason: 'non-regular-source-file' }
  }

  return { candidate: true, changes, reason: 'eligible-source-modifications' }
}

const planValidationReuse = ({
  action,
  base,
  baseChanged = false,
  before,
  cwd = process.cwd(),
  eventName,
  head
}) => {
  const none = reason => ({
    candidate: false,
    evidenceBase: '',
    evidenceHead: '',
    mode: 'none',
    reason,
    safe: false,
    version: prValidationReuseVersion
  })

  if (eventName !== 'pull_request') return none('non-pull-request-event')
  if (!isCommit(base) || !isCommit(head)) return none('invalid-pull-request-range')

  if (action === 'edited') {
    if (baseChanged) return none('base-changed')
    return {
      candidate: true,
      evidenceBase: base,
      evidenceHead: head,
      mode: 'exact',
      reason: 'unchanged-source-revision',
      safe: true,
      version: prValidationReuseVersion
    }
  }

  if (action !== 'synchronize') return none('unsupported-pull-request-action')
  const candidate = classifyAutofixCandidate({ before, cwd, head })
  if (!candidate.candidate) return none(candidate.reason)

  return {
    candidate: true,
    evidenceBase: base,
    evidenceHead: before,
    mode: 'eslint-autofix',
    reason: candidate.reason,
    safe: false,
    version: prValidationReuseVersion
  }
}

const runEslintFix = ({ cwd, filePath, source }) => {
  const pnpmCommand = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
  const result = spawnSync(
    pnpmCommand,
    [
      'exec',
      'eslint',
      '--fix-dry-run',
      '--format',
      'json',
      '--stdin',
      '--stdin-filename',
      filePath
    ],
    {
      cwd,
      encoding: 'utf8',
      input: source,
      maxBuffer: 1024 * 1024 * 20
    }
  )

  if ((result.status ?? 1) !== 0) {
    throw new Error(`ESLint could not produce a clean autofix for ${filePath}.`)
  }

  const output = JSON.parse(result.stdout)
  if (!Array.isArray(output) || output.length !== 1) {
    throw new Error(`ESLint returned an unexpected autofix result for ${filePath}.`)
  }
  return output[0].output ?? source
}

const verifyEslintAutofix = ({
  before,
  cwd = process.cwd(),
  eslintFix = runEslintFix,
  head
}) => {
  const candidate = classifyAutofixCandidate({ before, cwd, head })
  if (!candidate.candidate) return { ...candidate, safe: false }

  try {
    for (const change of candidate.changes) {
      const filePath = change.paths[0]
      const previousBlob = execFileSync('git', ['show', `${before}:${filePath}`], {
        cwd,
        maxBuffer: 1024 * 1024 * 20,
        stdio: ['ignore', 'pipe', 'pipe']
      })
      const currentHeadBlob = execFileSync('git', ['show', `${head}:${filePath}`], {
        cwd,
        maxBuffer: 1024 * 1024 * 20,
        stdio: ['ignore', 'pipe', 'pipe']
      })
      const previousSource = new TextDecoder('utf-8', { fatal: true }).decode(previousBlob)
      const fixedSource = eslintFix({ cwd, filePath, source: previousSource })
      if (!Buffer.from(fixedSource, 'utf8').equals(currentHeadBlob)) {
        return { ...candidate, reason: 'current-source-is-not-eslint-autofix', safe: false }
      }
    }
  } catch {
    return { ...candidate, reason: 'eslint-autofix-verification-failed', safe: false }
  }

  return { ...candidate, reason: 'verified-eslint-autofix', safe: true }
}

const parseArguments = args => {
  const parsed = {
    action: '',
    base: '',
    baseChanged: false,
    before: '',
    eventName: '',
    githubOutput: '',
    head: '',
    json: false,
    verifyEslintFix: false
  }

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]
    if (argument === '--action') parsed.action = args[++index] ?? ''
    else if (argument === '--base') parsed.base = args[++index] ?? ''
    else if (argument === '--base-changed') parsed.baseChanged = (args[++index] ?? '') === 'true'
    else if (argument === '--before') parsed.before = args[++index] ?? ''
    else if (argument === '--event-name') parsed.eventName = args[++index] ?? ''
    else if (argument === '--github-output') parsed.githubOutput = args[++index] ?? ''
    else if (argument === '--head') parsed.head = args[++index] ?? ''
    else if (argument === '--json') parsed.json = true
    else if (argument === '--verify-eslint-fix') parsed.verifyEslintFix = true
    else throw new Error(`Unknown PR validation reuse argument: ${argument}`)
  }

  return parsed
}

const writeGithubOutputs = (outputPath, result) => {
  const outputs = {
    candidate: result.candidate,
    evidence_base: result.evidenceBase,
    evidence_head: result.evidenceHead,
    mode: result.mode,
    reason: result.reason,
    safe: result.safe,
    version: result.version
  }
  appendFileSync(
    outputPath,
    `${Object.entries(outputs).map(([key, value]) => `${key}=${String(value)}`).join('\n')}\n`
  )
}

const runPrValidationReuse = (args = process.argv.slice(2)) => {
  const input = parseArguments(args)
  let result = planValidationReuse(input)

  if (input.verifyEslintFix && result.mode === 'eslint-autofix') {
    const verified = verifyEslintAutofix({
      before: result.evidenceHead,
      head: input.head
    })
    result = {
      ...result,
      reason: verified.reason,
      safe: verified.safe
    }
  }

  if (input.githubOutput !== '') writeGithubOutputs(input.githubOutput, result)
  if (input.json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
  else process.stdout.write(`[pr-validation-reuse] ${result.mode}: ${result.reason}\n`)
  return result
}

module.exports = {
  classifyAutofixCandidate,
  maximumAutofixFiles,
  planValidationReuse,
  parseRawDiff,
  prValidationReuseVersion,
  reusableSourcePathPattern,
  runEslintFix,
  runPrValidationReuse,
  verifyEslintAutofix
}

if (require.main === module) {
  try {
    runPrValidationReuse()
  } catch (error) {
    process.stderr.write(`[pr-validation-reuse] ${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  }
}
