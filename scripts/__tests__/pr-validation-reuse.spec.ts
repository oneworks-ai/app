import { Buffer } from 'node:buffer'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  classifyAutofixCandidate,
  planValidationReuse,
  runEslintFix,
  verifyEslintAutofix
} from '../pr-validation-reuse.cjs'

const runGit = (cwd: string, args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()

const writeGitBlob = (cwd: string, source: string) =>
  execFileSync('git', ['hash-object', '-w', '--stdin'], {
    cwd,
    encoding: 'utf8',
    input: source
  }).trim()

const write = (cwd: string, filePath: string, source: string) => {
  const absolutePath = path.join(cwd, filePath)
  mkdirSync(path.dirname(absolutePath), { recursive: true })
  writeFileSync(absolutePath, source)
}

const createRepository = () => {
  const cwd = mkdtempSync(path.join(tmpdir(), 'oneworks-pr-reuse-'))
  runGit(cwd, ['init', '--quiet'])
  runGit(cwd, ['config', 'user.email', 'ci@example.com'])
  runGit(cwd, ['config', 'user.name', 'CI'])
  write(cwd, 'apps/client/src/example.ts', 'export const value = 1 ;\n')
  runGit(cwd, ['add', '--', 'apps/client/src/example.ts'])
  runGit(cwd, ['commit', '--quiet', '-m', 'test: base'])
  return cwd
}

describe('pr validation reuse', () => {
  it('reuses exact source evidence for body edits but never for base edits', () => {
    const base = 'a'.repeat(40)
    const head = 'b'.repeat(40)

    expect(planValidationReuse({
      action: 'edited',
      base,
      before: '',
      eventName: 'pull_request',
      head
    })).toMatchObject({
      candidate: true,
      evidenceBase: base,
      evidenceHead: head,
      mode: 'exact',
      safe: true
    })

    expect(planValidationReuse({
      action: 'edited',
      base,
      baseChanged: true,
      before: '',
      eventName: 'pull_request',
      head
    })).toMatchObject({
      candidate: false,
      mode: 'none',
      reason: 'base-changed'
    })
  })

  it('only admits bounded modified source files as ESLint autofix candidates', () => {
    const cwd = createRepository()
    const before = runGit(cwd, ['rev-parse', 'HEAD'])
    write(cwd, 'apps/client/src/example.ts', 'export const value = 1;\n')
    runGit(cwd, ['add', '--', 'apps/client/src/example.ts'])
    runGit(cwd, ['commit', '--quiet', '-m', 'style: fix lint'])
    const head = runGit(cwd, ['rev-parse', 'HEAD'])

    expect(classifyAutofixCandidate({ before, cwd, head })).toMatchObject({
      candidate: true,
      reason: 'eligible-source-modifications'
    })

    write(cwd, '.github/workflows/quality.yml', 'name: unsafe\n')
    runGit(cwd, ['add', '--', '.github/workflows/quality.yml'])
    runGit(cwd, ['commit', '--quiet', '-m', 'ci: change workflow'])
    const unsafeHead = runGit(cwd, ['rev-parse', 'HEAD'])
    expect(classifyAutofixCandidate({ before: head, cwd, head: unsafeHead })).toMatchObject({
      candidate: false,
      reason: 'non-modification-change'
    })
  })

  it('rejects hidden authority changes after rewritten history', () => {
    const cwd = createRepository()
    const commonBase = runGit(cwd, ['rev-parse', 'HEAD'])
    write(cwd, '.github/workflows/quality.yml', 'name: unsafe\n')
    runGit(cwd, ['add', '--', '.github/workflows/quality.yml'])
    runGit(cwd, ['commit', '--quiet', '-m', 'ci: old workflow'])
    const before = runGit(cwd, ['rev-parse', 'HEAD'])

    runGit(cwd, ['checkout', '--quiet', '--detach', commonBase])
    write(cwd, 'apps/client/src/example.ts', 'export const value = 1;\n')
    runGit(cwd, ['add', '--', 'apps/client/src/example.ts'])
    runGit(cwd, ['commit', '--quiet', '-m', 'style: rewritten lint fix'])
    const head = runGit(cwd, ['rev-parse', 'HEAD'])

    expect(classifyAutofixCandidate({ before, cwd, head })).toMatchObject({
      candidate: false,
      reason: 'non-modification-change'
    })
    expect(verifyEslintAutofix({
      before,
      cwd,
      eslintFix: ({ source }) => source.replace('1 ;', '1;'),
      head
    })).toMatchObject({ safe: false, reason: 'non-modification-change' })
  })

  it('rejects source mode changes even when the content is an ESLint autofix', () => {
    const cwd = createRepository()
    const before = runGit(cwd, ['rev-parse', 'HEAD'])
    write(cwd, 'apps/client/src/example.ts', 'export const value = 1;\n')
    runGit(cwd, ['add', '--', 'apps/client/src/example.ts'])
    runGit(cwd, ['update-index', '--chmod=+x', '--', 'apps/client/src/example.ts'])
    runGit(cwd, ['commit', '--quiet', '-m', 'style: fix lint and mode'])
    const head = runGit(cwd, ['rev-parse', 'HEAD'])

    expect(classifyAutofixCandidate({ before, cwd, head })).toMatchObject({
      candidate: false,
      reason: 'file-mode-changed'
    })
  })

  it('rejects symlink retargets that resemble ESLint source fixes', () => {
    const cwd = createRepository()
    const filePath = 'apps/client/src/example.ts'
    const beforeBlob = writeGitBlob(cwd, "import { unused } from 'foo'\n\nexport const value = 1\n")
    runGit(cwd, ['update-index', '--cacheinfo', `120000,${beforeBlob},${filePath}`])
    runGit(cwd, ['commit', '--quiet', '-m', 'test: symlink source'])
    const before = runGit(cwd, ['rev-parse', 'HEAD'])

    const headBlob = writeGitBlob(cwd, '\nexport const value = 1\n')
    runGit(cwd, ['update-index', '--cacheinfo', `120000,${headBlob},${filePath}`])
    runGit(cwd, ['commit', '--quiet', '-m', 'style: retarget symlink'])
    const head = runGit(cwd, ['rev-parse', 'HEAD'])

    expect(classifyAutofixCandidate({ before, cwd, head })).toMatchObject({
      candidate: false,
      reason: 'non-regular-source-file'
    })
  })

  it('compares against the immutable head blob instead of the mutable worktree', () => {
    const cwd = createRepository()
    const before = runGit(cwd, ['rev-parse', 'HEAD'])
    const fixed = 'export const value = 1;\n'
    write(cwd, 'apps/client/src/example.ts', fixed)
    runGit(cwd, ['add', '--', 'apps/client/src/example.ts'])
    runGit(cwd, ['commit', '--quiet', '-m', 'style: fix lint'])
    const head = runGit(cwd, ['rev-parse', 'HEAD'])
    write(cwd, 'apps/client/src/example.ts', 'export const compromised = true\n')

    expect(verifyEslintAutofix({
      before,
      cwd,
      eslintFix: ({ source }) => source.replace('1 ;', '1;'),
      head
    })).toMatchObject({ safe: true, reason: 'verified-eslint-autofix' })
  })

  it('rejects malformed UTF-8 instead of comparing replacement characters', () => {
    const cwd = createRepository()
    const malformed = Buffer.concat([
      Buffer.from('export const value = 1 ; // '),
      Buffer.from([255]),
      Buffer.from('\n')
    ])
    writeFileSync(path.join(cwd, 'apps/client/src/example.ts'), malformed)
    runGit(cwd, ['add', '--', 'apps/client/src/example.ts'])
    runGit(cwd, ['commit', '--quiet', '-m', 'test: malformed source'])
    const before = runGit(cwd, ['rev-parse', 'HEAD'])

    write(cwd, 'apps/client/src/example.ts', 'export const value = 1; // �\n')
    runGit(cwd, ['add', '--', 'apps/client/src/example.ts'])
    runGit(cwd, ['commit', '--quiet', '-m', 'style: apparent lint fix'])
    const head = runGit(cwd, ['rev-parse', 'HEAD'])

    expect(verifyEslintAutofix({
      before,
      cwd,
      eslintFix: ({ source }) => source.replace('1 ;', '1;'),
      head
    })).toMatchObject({ safe: false, reason: 'eslint-autofix-verification-failed' })
  })

  it('requires current bytes to exactly match the ESLint autofix result', () => {
    const cwd = createRepository()
    const before = runGit(cwd, ['rev-parse', 'HEAD'])
    write(cwd, 'apps/client/src/example.ts', 'export const value = 1;\n')
    runGit(cwd, ['add', '--', 'apps/client/src/example.ts'])
    runGit(cwd, ['commit', '--quiet', '-m', 'style: fix lint'])
    const head = runGit(cwd, ['rev-parse', 'HEAD'])

    expect(verifyEslintAutofix({
      before,
      cwd,
      eslintFix: ({ source }) => source.replace('1 ;', '1;'),
      head
    })).toMatchObject({ safe: true, reason: 'verified-eslint-autofix' })

    expect(verifyEslintAutofix({
      before,
      cwd,
      eslintFix: ({ source }) => source,
      head
    })).toMatchObject({ safe: false, reason: 'current-source-is-not-eslint-autofix' })
  })

  it('keeps the current file intact while validating previous source bytes', () => {
    const cwd = createRepository()
    const before = runGit(cwd, ['rev-parse', 'HEAD'])
    const current = 'export const value = 1;\n'
    write(cwd, 'apps/client/src/example.ts', current)
    runGit(cwd, ['add', '--', 'apps/client/src/example.ts'])
    runGit(cwd, ['commit', '--quiet', '-m', 'style: fix lint'])
    const head = runGit(cwd, ['rev-parse', 'HEAD'])

    verifyEslintAutofix({
      before,
      cwd,
      eslintFix: () => current,
      head
    })
    expect(readFileSync(path.join(cwd, 'apps/client/src/example.ts'), 'utf8')).toBe(current)
  })

  it('uses the repository ESLint configuration to produce the authoritative fix bytes', () => {
    const filePath = 'packages/benchmark/src/types.ts'
    const current = readFileSync(filePath, 'utf8')
    const previous = `import { readFileSync } from 'node:fs'\n\n${current}`

    expect(runEslintFix({ cwd: process.cwd(), filePath, source: previous })).toBe(`\n${current}`)
  })
})
