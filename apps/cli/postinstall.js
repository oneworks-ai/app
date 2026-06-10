#!/usr/bin/env node
const { spawnSync } = require('node:child_process')
const { existsSync, readFileSync } = require('node:fs')
const { join, resolve } = require('node:path')
const process = require('node:process')

const isFalseLike = value => ['0', 'false', 'no', 'off'].includes(String(value ?? '').trim().toLowerCase())
const isTrueLike = value => ['1', 'true', 'yes', 'on'].includes(String(value ?? '').trim().toLowerCase())

const shouldSkip = () => (
  isTrueLike(process.env.ONEWORKS_SKIP_POSTINSTALL) ||
  isTrueLike(process.env.ONEWORKS_SKIP_ADAPTER_PREPARE) ||
  process.env.ONEWORKS_ADAPTER_PREPARE_POSTINSTALL_ACTIVE === '1' ||
  (
    process.env.CI != null &&
    !isFalseLike(process.env.CI) &&
    !isTrueLike(process.env.ONEWORKS_POSTINSTALL_PREPARE)
  )
)

const isPlainObject = value => value != null && typeof value === 'object' && !Array.isArray(value)

const readJsonConfig = projectDir => {
  for (const relativePath of ['.oo.config.json', 'infra/.oo.config.json']) {
    const configPath = join(projectDir, relativePath)
    if (!existsSync(configPath)) continue
    try {
      return JSON.parse(readFileSync(configPath, 'utf8'))
    } catch (error) {
      console.warn(`[oneworks] Skipping adapter CLI postinstall prepare: failed to read ${relativePath}.`)
      console.warn(error instanceof Error ? error.message : String(error))
      return undefined
    }
  }
  return undefined
}

const hasPrepareOnInstallTarget = config => {
  const adapters = isPlainObject(config?.adapters) ? config.adapters : undefined
  if (adapters == null) return false

  return Object.values(adapters).some(adapterConfig => {
    if (!isPlainObject(adapterConfig)) return false
    return ['cli', 'routerCli'].some(key => (
      isPlainObject(adapterConfig[key]) && adapterConfig[key].prepareOnInstall === true
    ))
  })
}

if (!shouldSkip()) {
  const projectDir = resolve(process.env.INIT_CWD || process.cwd())
  const config = readJsonConfig(projectDir)
  if (hasPrepareOnInstallTarget(config)) {
    const result = spawnSync(
      process.execPath,
      [join(__dirname, 'cli.js'), 'adapter', 'prepare', '--from-postinstall'],
      {
        cwd: projectDir,
        env: {
          ...process.env,
          ONEWORKS_ADAPTER_PREPARE_POSTINSTALL_ACTIVE: '1'
        },
        stdio: 'inherit'
      }
    )

    if (result.status !== 0) {
      const strict = isTrueLike(process.env.ONEWORKS_POSTINSTALL_STRICT)
      console.warn('[oneworks] Adapter CLI postinstall prepare failed.')
      if (strict) {
        process.exit(result.status ?? 1)
      }
    }
  }
}
