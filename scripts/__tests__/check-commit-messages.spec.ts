import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

const checkerPath = path.join(process.cwd(), 'scripts/check-commit-messages.mjs')

describe('commit message checking', () => {
  it('accepts merge commits by structure while rejecting a regular commit with the same title', () => {
    const repoRoot = mkdtempSync(path.join(tmpdir(), 'oneworks-commitmsg-'))
    const runGit = (args: string[]) =>
      execFileSync('git', args, {
        cwd: repoRoot,
        encoding: 'utf8'
      }).trim()
    const commit = (file: string, contents: string, message: string) => {
      writeFileSync(path.join(repoRoot, file), contents)
      runGit(['add', file])
      runGit(['commit', '-m', message])
    }

    try {
      runGit(['init'])
      runGit(['config', 'user.name', 'Test'])
      runGit(['config', 'user.email', 'test@example.com'])
      commit('base.txt', 'base\n', 'feat: add base')
      const base = runGit(['rev-parse', 'HEAD'])
      const defaultBranch = runGit(['branch', '--show-current'])

      runGit(['checkout', '-b', 'topic'])
      commit('topic.txt', 'topic\n', 'fix: add topic')
      runGit(['checkout', defaultBranch])
      commit('main.txt', 'main\n', 'chore: update main')
      runGit(['merge', '--no-ff', 'topic', '-m', 'Merge rc.5 desktop and release fixes'])
      const mergeHead = runGit(['rev-parse', 'HEAD'])

      const mergeResult = spawnSync(process.execPath, [checkerPath, base, mergeHead], {
        cwd: repoRoot,
        encoding: 'utf8'
      })
      expect(mergeResult.status).toBe(0)
      expect(mergeResult.stdout).toContain('[commitmsg] validated 3 commit(s)')

      commit('regular.txt', 'regular\n', 'Merge rc.5 desktop and release fixes')
      const regularHead = runGit(['rev-parse', 'HEAD'])
      const regularResult = spawnSync(process.execPath, [checkerPath, mergeHead, regularHead], {
        cwd: repoRoot,
        encoding: 'utf8'
      })
      expect(regularResult.status).toBe(1)
      expect(regularResult.stderr).toContain('invalid commit subjects')
    } finally {
      rmSync(repoRoot, { force: true, recursive: true })
    }
  })
})
