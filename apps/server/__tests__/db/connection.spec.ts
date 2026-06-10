import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { resolveProjectHomePath } from '@oneworks/utils'

import { createConnection } from '../../src/db/connection'
import { createSqliteDatabase } from '../../src/db/sqlite'

const projectPathEnvKeys = [
  '__ONEWORKS_PROJECT_LAUNCH_CWD__',
  '__ONEWORKS_PROJECT_WORKSPACE_FOLDER__',
  '__ONEWORKS_PROJECT_WORKSPACE_FOLDER_RESOLVE_CWD__',
  '__ONEWORKS_PROJECT_PRIMARY_WORKSPACE_FOLDER__',
  '__ONEWORKS_PROJECT_BASE_DIR__',
  '__ONEWORKS_PROJECT_BASE_DIR_RESOLVE_CWD__',
  '__ONEWORKS_PROJECT_HOME_PROJECTS_DIR__'
] as const

describe('createConnection', () => {
  const originalProjectPathEnv = Object.fromEntries(
    projectPathEnvKeys.map(key => [key, process.env[key]])
  )

  afterEach(() => {
    vi.restoreAllMocks()
    delete process.env.DB_PATH
    for (const key of projectPathEnvKeys) {
      const originalValue = originalProjectPathEnv[key]
      if (originalValue == null) {
        delete process.env[key]
      } else {
        process.env[key] = originalValue
      }
    }
  })

  it('uses the primary worktree project-local DB when DB_PATH is not configured', () => {
    const primary = fs.mkdtempSync(path.join(os.tmpdir(), 'ow-db-primary-'))
    const worktree = fs.mkdtempSync(path.join(os.tmpdir(), 'ow-db-worktree-'))
    const projectsDir = path.join(primary, '.oneworks-projects')
    process.env.__ONEWORKS_PROJECT_LAUNCH_CWD__ = worktree
    process.env.__ONEWORKS_PROJECT_WORKSPACE_FOLDER__ = worktree
    process.env.__ONEWORKS_PROJECT_PRIMARY_WORKSPACE_FOLDER__ = primary
    process.env.__ONEWORKS_PROJECT_HOME_PROJECTS_DIR__ = projectsDir

    const connection = createConnection()
    const expectedDbPath = resolveProjectHomePath(worktree, process.env, '.local', 'server', 'db.sqlite')

    try {
      expect(connection.dbPath).toBe(expectedDbPath)
      expect(fs.existsSync(path.dirname(expectedDbPath))).toBe(true)
      expect(fs.existsSync(connection.dbPath)).toBe(true)
    } finally {
      connection.db.close()
      fs.rmSync(primary, { force: true, recursive: true })
      fs.rmSync(worktree, { force: true, recursive: true })
    }
  })

  it('does not backfill a legacy project-local DB before opening the default connection', () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'ow-db-workspace-'))
    const projectsDir = path.join(workspace, '.oneworks-projects')
    process.env.__ONEWORKS_PROJECT_LAUNCH_CWD__ = workspace
    process.env.__ONEWORKS_PROJECT_WORKSPACE_FOLDER__ = workspace
    process.env.__ONEWORKS_PROJECT_HOME_PROJECTS_DIR__ = projectsDir

    const legacyDbPath = path.join(workspace, '.oo', '.local', 'server', 'db.sqlite')
    fs.mkdirSync(path.dirname(legacyDbPath), { recursive: true })
    const legacyDb = createSqliteDatabase(legacyDbPath)
    legacyDb.exec("CREATE TABLE marker (value TEXT); INSERT INTO marker (value) VALUES ('legacy');")
    legacyDb.close()

    const connection = createConnection()
    const expectedDbPath = resolveProjectHomePath(workspace, process.env, '.local', 'server', 'db.sqlite')

    try {
      expect(connection.dbPath).toBe(expectedDbPath)
      expect(
        connection.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'marker'")
          .get()
      ).toBeUndefined()
      expect(fs.existsSync(legacyDbPath)).toBe(true)
    } finally {
      connection.db.close()
      fs.rmSync(workspace, { force: true, recursive: true })
    }
  })

  it('does not backfill a legacy project-local DB when DB_PATH is the explicit default file path', () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'ow-db-workspace-'))
    const projectsDir = path.join(workspace, '.oneworks-projects')
    process.env.__ONEWORKS_PROJECT_LAUNCH_CWD__ = workspace
    process.env.__ONEWORKS_PROJECT_WORKSPACE_FOLDER__ = workspace
    process.env.__ONEWORKS_PROJECT_HOME_PROJECTS_DIR__ = projectsDir

    const legacyDbPath = path.join(workspace, '.oo', '.local', 'server', 'db.sqlite')
    fs.mkdirSync(path.dirname(legacyDbPath), { recursive: true })
    const legacyDb = createSqliteDatabase(legacyDbPath)
    legacyDb.exec("CREATE TABLE marker (value TEXT); INSERT INTO marker (value) VALUES ('legacy-explicit');")
    legacyDb.close()

    const expectedDbPath = resolveProjectHomePath(workspace, process.env, '.local', 'server', 'db.sqlite')
    process.env.DB_PATH = expectedDbPath

    const connection = createConnection()

    try {
      expect(connection.dbPath).toBe(expectedDbPath)
      expect(
        connection.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'marker'")
          .get()
      ).toBeUndefined()
      expect(fs.existsSync(legacyDbPath)).toBe(true)
    } finally {
      connection.db.close()
      fs.rmSync(workspace, { force: true, recursive: true })
    }
  })

  it('creates missing parent directories for a custom file path', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ow-db-path-'))
    const dbPath = path.join(tempDir, 'nested', 'custom.sqlite')
    process.env.DB_PATH = dbPath

    const connection = createConnection()

    try {
      expect(connection.dbPath).toBe(dbPath)
      expect(fs.existsSync(path.dirname(dbPath))).toBe(true)
      expect(fs.existsSync(dbPath)).toBe(true)
    } finally {
      connection.db.close()
      fs.rmSync(tempDir, { force: true, recursive: true })
    }
  })

  it('appends db.sqlite when DB_PATH points to a directory', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ow-db-dir-'))
    process.env.DB_PATH = tempDir

    const connection = createConnection()

    try {
      expect(connection.dbPath).toBe(path.join(tempDir, 'db.sqlite'))
      expect(fs.existsSync(connection.dbPath)).toBe(true)
    } finally {
      connection.db.close()
      fs.rmSync(tempDir, { force: true, recursive: true })
    }
  })
})
