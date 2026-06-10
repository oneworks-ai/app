import fs from 'node:fs'
import path from 'node:path'
import process, { env as processEnv } from 'node:process'

import { resolveProjectHomePath } from '@oneworks/utils/ai-path'
import { migrateProjectHomeSegmentSync } from '@oneworks/utils/project-home-migration'

import { createSqliteDatabase } from './sqlite'
import type { SqliteDatabase } from './sqlite'

export interface DbConnection {
  db: SqliteDatabase
  dbPath: string
}

export function resolveDefaultDbPath(): string {
  return resolveProjectHomePath(process.cwd(), processEnv, '.local', 'server', 'db.sqlite')
}

const migrateDefaultDbPath = () => {
  try {
    migrateProjectHomeSegmentSync(process.cwd(), processEnv, '.local')
  } catch {
    // Startup surfaces migration failures; direct DB opens should still create the default path.
  }
}

export function createConnection(): DbConnection {
  let dbPath = processEnv.DB_PATH
  const defaultDbPath = resolveDefaultDbPath()

  if (dbPath == null || dbPath === '') {
    migrateDefaultDbPath()
    dbPath = defaultDbPath
  } else {
    if (fs.existsSync(dbPath) && fs.statSync(dbPath).isDirectory()) {
      dbPath = path.join(dbPath, 'db.sqlite')
    }
    if (path.resolve(dbPath) === path.resolve(defaultDbPath)) {
      migrateDefaultDbPath()
    }
  }

  const dir = path.dirname(dbPath)
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }

  return {
    dbPath,
    db: createSqliteDatabase(dbPath)
  }
}
