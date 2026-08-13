/* eslint-disable max-lines -- loader process-boundary regressions share expensive fixture setup. */
import { spawn, spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { delimiter, join, resolve } from 'node:path'
import process from 'node:process'

import { afterEach, describe, expect, it } from 'vitest'

const nodeRequire = createRequire(import.meta.url)
const { resolveActiveCliPackageDir } = nodeRequire('../entry.js') as {
  resolveActiveCliPackageDir: (
    packageName: string,
    packageDir: string,
    env?: Record<string, string | undefined>
  ) => string
}

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

describe('cli-helper loader wrapper', () => {
  it('preserves exact NODE_PATH entries before module resolution', async () => {
    const root = await mkdtemp(resolve(tmpdir(), 'ow-cli-helper-node-path-'))
    tempDirs.push(root)
    const adjacentModules = join(root, 'modules')
    const exactModules = join(root, 'modules ')
    const entryPath = join(root, 'entry.cjs')
    for (const [modulesDir, identity] of [[adjacentModules, 'adjacent'], [exactModules, 'exact']] as const) {
      const packageDir = join(modulesDir, 'identity')
      await mkdir(packageDir, { recursive: true })
      await writeFile(join(packageDir, 'index.js'), `module.exports = ${JSON.stringify(identity)}\n`, 'utf8')
    }
    await writeFile(entryPath, "process.stdout.write(require('identity'))\n", 'utf8')

    const result = spawnSync(process.execPath, [resolve(process.cwd(), 'packages/cli-helper/loader.js')], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        NODE_PATH: [exactModules, adjacentModules].join(delimiter),
        __ONEWORKS_PROJECT_CLI_BIN_SOURCE_ENTRY__: entryPath,
        __ONEWORKS_PROJECT_PACKAGE_DIR__: root
      },
      encoding: 'utf8'
    })

    expect(result.status).toBe(0)
    expect(result.stderr).toBe('')
    expect(result.stdout).toBe('exact')
  })

  it('forwards a required desktop owner IPC channel to the re-executed wrapper', async () => {
    const tempDir = await mkdtemp(resolve(tmpdir(), 'ow-cli-helper-owner-ipc-'))
    tempDirs.push(tempDir)

    const entryPath = resolve(tempDir, 'entry.cjs')
    const wrapperPath = resolve(tempDir, 'wrapper.cjs')
    const ownerChannelPath = resolve(process.cwd(), 'apps/desktop/src/server-owner-channel.cjs')
    const cliEntryPath = resolve(process.cwd(), 'packages/cli-helper/entry.js')
    await writeFile(
      entryPath,
      "process.stdout.write('owner-connected=' + process.connected); process.exit(0)\n"
    )
    await writeFile(
      wrapperPath,
      `
const { installDesktopServerOwnerChannel } = require(${JSON.stringify(ownerChannelPath)})
installDesktopServerOwnerChannel()
require(${JSON.stringify(cliEntryPath)}).runCliPackageEntrypoint({
  packageDir: ${JSON.stringify(tempDir)},
  sourceEntry: ${JSON.stringify(entryPath)}
})
      `
    )

    const child = spawn(process.execPath, [wrapperPath], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        __ONEWORKS_DESKTOP_SERVER_OWNER_CHANNEL__: 'ipc-v1'
      },
      stdio: ['ignore', 'pipe', 'pipe', 'ipc']
    })
    let stdout = ''
    let stderr = ''
    if (child.stdout == null || child.stderr == null) {
      throw new Error('Loader IPC test requires piped stdout and stderr.')
    }
    child.stdout.on('data', chunk => {
      stdout += chunk.toString()
    })
    child.stderr.on('data', chunk => {
      stderr += chunk.toString()
    })

    const result = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolveExit, reject) => {
      child.once('error', reject)
      child.once('exit', (code, signal) => resolveExit({ code, signal }))
    })

    expect(result).toEqual({ code: 0, signal: null })
    expect(stderr).toBe('')
    expect(stdout).toContain('owner-connected=true')
  })

  it('redirects a direct package bin to its validated active module package', async () => {
    const tempDir = await mkdtemp(resolve(tmpdir(), 'ow-cli-helper-active-package-'))
    tempDirs.push(tempDir)

    const packageName = '@oneworks/server'
    const bundledPackageDir = join(tempDir, 'bundled-server')
    const activePackageDir = join(tempDir, 'active-server')
    const metadataDir = join(tempDir, '.oneworks', 'bootstrap', 'module-updates')
    await mkdir(bundledPackageDir, { recursive: true })
    await mkdir(activePackageDir, { recursive: true })
    await mkdir(metadataDir, { recursive: true })
    await writeFile(
      join(activePackageDir, 'package.json'),
      JSON.stringify({ name: packageName, version: '3.5.0' })
    )
    await writeFile(
      join(metadataDir, 'oneworks__server.json'),
      JSON.stringify({ packageDir: activePackageDir, packageName, version: '3.5.0' })
    )

    expect(resolveActiveCliPackageDir(packageName, bundledPackageDir, {
      __ONEWORKS_PROJECT_REAL_HOME__: tempDir
    })).toBe(activePackageDir)

    await writeFile(
      join(metadataDir, 'oneworks__server.json'),
      JSON.stringify({ packageDir: activePackageDir, packageName, version: '3.6.0' })
    )
    expect(resolveActiveCliPackageDir(packageName, bundledPackageDir, {
      __ONEWORKS_PROJECT_REAL_HOME__: tempDir
    })).toBe(bundledPackageDir)
  })

  it('reads active-package metadata only from the exact whitespace-bearing real home', async () => {
    const root = await mkdtemp(resolve(tmpdir(), 'ow-cli-helper-home-path-'))
    tempDirs.push(root)
    const packageName = '@oneworks/server'
    const bundledPackageDir = join(root, 'bundled')
    const activePackageDir = join(root, 'active')
    const exactHome = join(root, 'home ')
    const adjacentHome = join(root, 'home')
    await mkdir(bundledPackageDir)
    await mkdir(activePackageDir)
    await writeFile(join(activePackageDir, 'package.json'), JSON.stringify({ name: packageName, version: '4.0.0' }))
    for (const [home, packageDir] of [[exactHome, activePackageDir], [adjacentHome, bundledPackageDir]] as const) {
      const metadataDir = join(home, '.oneworks', 'bootstrap', 'module-updates')
      await mkdir(metadataDir, { recursive: true })
      await writeFile(
        join(metadataDir, 'oneworks__server.json'),
        JSON.stringify({ packageDir, packageName, version: '4.0.0' })
      )
    }

    expect(resolveActiveCliPackageDir(packageName, bundledPackageDir, {
      __ONEWORKS_PROJECT_REAL_HOME__: exactHome
    })).toBe(activePackageDir)
  })

  it('propagates the spawned cli exit code', async () => {
    const tempDir = await mkdtemp(resolve(tmpdir(), 'ow-cli-helper-'))
    tempDirs.push(tempDir)

    const entryPath = resolve(tempDir, 'entry.js')
    await writeFile(entryPath, 'process.exit(Number(process.env.TEST_EXIT_CODE || "0"))\n')

    const result = spawnSync(
      process.execPath,
      [resolve(process.cwd(), 'packages/cli-helper/loader.js')],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          __ONEWORKS_PROJECT_PACKAGE_DIR__: tempDir,
          __ONEWORKS_PROJECT_CLI_BIN_SOURCE_ENTRY__: entryPath,
          TEST_EXIT_CODE: '7'
        },
        encoding: 'utf8'
      }
    )

    expect(result.status).toBe(7)
    expect(result.signal).toBeNull()
  })

  it('prefers a packaged runtime bundle when explicitly requested', async () => {
    const tempDir = await mkdtemp(resolve(tmpdir(), 'ow-cli-helper-dist-entry-'))
    tempDirs.push(tempDir)

    const sourceEntryPath = resolve(tempDir, 'source.cjs')
    const distEntryPath = resolve(tempDir, 'dist.mjs')
    await writeFile(sourceEntryPath, "process.stdout.write('source-entry')\n")
    await writeFile(distEntryPath, "process.stdout.write('dist-entry')\n")

    const result = spawnSync(
      process.execPath,
      [resolve(process.cwd(), 'packages/cli-helper/loader.js')],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          __ONEWORKS_CLI_HELPER_LOADER_ACTIVE__: 'true',
          __ONEWORKS_PROJECT_CLI_BIN_DIST_ENTRY__: distEntryPath,
          __ONEWORKS_PROJECT_CLI_BIN_SOURCE_ENTRY__: sourceEntryPath,
          __ONEWORKS_PROJECT_CLI_PREFER_DIST_ENTRY__: 'true',
          __ONEWORKS_PROJECT_PACKAGE_DIR__: tempDir
        },
        encoding: 'utf8'
      }
    )

    expect(result.status).toBe(0)
    expect(result.signal).toBeNull()
    expect(result.stderr).toBe('')
    expect(result.stdout).toBe('dist-entry')
  })

  it('exits when an ESM runtime entry fails to load', async () => {
    const tempDir = await mkdtemp(resolve(tmpdir(), 'ow-cli-helper-broken-dist-entry-'))
    tempDirs.push(tempDir)

    const distEntryPath = resolve(tempDir, 'dist.mjs')
    await writeFile(distEntryPath, "throw new Error('broken-runtime-entry')\n")

    const result = spawnSync(
      process.execPath,
      [resolve(process.cwd(), 'packages/cli-helper/loader.js')],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          __ONEWORKS_CLI_HELPER_LOADER_ACTIVE__: 'true',
          __ONEWORKS_PROJECT_CLI_BIN_DIST_ENTRY__: distEntryPath,
          __ONEWORKS_PROJECT_CLI_PREFER_DIST_ENTRY__: 'true',
          __ONEWORKS_PROJECT_PACKAGE_DIR__: tempDir
        },
        encoding: 'utf8'
      }
    )

    expect(result.status).toBe(1)
    expect(result.signal).toBeNull()
    expect(result.stderr).toContain('broken-runtime-entry')
  })

  it('installs its own TypeScript loader when the parent leaks a legacy loader marker', async () => {
    const tempDir = await mkdtemp(resolve(tmpdir(), 'ow-cli-helper-polluted-'))
    tempDirs.push(tempDir)

    const entryPath = resolve(tempDir, 'entry.ts')
    await writeFile(entryPath, "const result: string = 'loader-ready'; process.stdout.write(result)\n")

    const result = spawnSync(
      process.execPath,
      [resolve(process.cwd(), 'packages/cli-helper/loader.js')],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          __IS_LOADER_CLI__: 'true',
          __ONEWORKS_CLI_HELPER_LOADER_ACTIVE__: undefined,
          __ONEWORKS_PROJECT_PACKAGE_DIR__: tempDir,
          __ONEWORKS_PROJECT_CLI_BIN_SOURCE_ENTRY__: entryPath
        },
        encoding: 'utf8'
      }
    )

    expect(result.status).toBe(0)
    expect(result.signal).toBeNull()
    expect(result.stderr).toBe('')
    expect(result.stdout).toBe('loader-ready')
  })

  it('installs the ESM source resolver for lazy TypeScript imports', async () => {
    const tempDir = await mkdtemp(resolve(tmpdir(), 'ow-cli-helper-lazy-import-'))
    tempDirs.push(tempDir)

    const entryPath = resolve(tempDir, 'entry.ts')
    await writeFile(
      entryPath,
      "void import('./lazy.js').then(({ value }) => process.stdout.write(value))\n"
    )
    await writeFile(
      resolve(tempDir, 'lazy.ts'),
      "export const value: string = 'lazy-loader-ready'\n"
    )

    const result = spawnSync(
      process.execPath,
      [resolve(process.cwd(), 'packages/cli-helper/loader.js')],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          __ONEWORKS_CLI_HELPER_LOADER_ACTIVE__: undefined,
          __ONEWORKS_PROJECT_PACKAGE_DIR__: tempDir,
          __ONEWORKS_PROJECT_CLI_BIN_SOURCE_ENTRY__: entryPath
        },
        encoding: 'utf8'
      }
    )

    expect(result.status).toBe(0)
    expect(result.signal).toBeNull()
    expect(result.stderr).toBe('')
    expect(result.stdout).toBe('lazy-loader-ready')
  })

  it('bootstraps cli package environment before delegating to the loader', async () => {
    const workspaceDir = await mkdtemp(resolve(tmpdir(), 'ow-cli-helper-entry-'))
    tempDirs.push(workspaceDir)

    const nestedCwd = resolve(workspaceDir, 'packages/demo/src')
    const packageDir = resolve(workspaceDir, 'packages/fake-cli')
    const realHome = await mkdtemp(resolve(tmpdir(), 'ow-cli-helper-real-home-'))
    tempDirs.push(realHome)
    await mkdir(nestedCwd, { recursive: true })
    await mkdir(packageDir, { recursive: true })
    await mkdir(resolve(realHome, '.config/git'), { recursive: true })
    await writeFile(resolve(workspaceDir, '.oo.config.json'), '{}\n')
    await writeFile(resolve(realHome, '.gitconfig'), '[user]\\n\\tname = real\\n')
    await writeFile(resolve(realHome, '.config/git/config'), '[alias]\\n\\tco = checkout\\n')
    const realWorkspaceDir = await realpath(workspaceDir)
    const mockedProjectMockHome = resolve(realWorkspaceDir, '.oneworks/projects/mock-project/.mock')
    const entryPath = resolve(process.cwd(), 'packages/cli-helper/entry.js')
    const result = spawnSync(
      process.execPath,
      [
        '-e',
        `
const Module = require('node:module')
const entryPath = ${JSON.stringify(entryPath)}
const originalLoad = Module._load

Module._load = function(request, parent, isMain) {
  if (request === '@oneworks/register/dotenv') {
    return {
      migrateProjectHomeSegmentsSync: () => [],
      resolveProjectWorkspaceFolder: () => ${JSON.stringify(realWorkspaceDir)},
      resolveProjectOoBaseDir: () => ${JSON.stringify(resolve(realWorkspaceDir, '.oo'))},
      resolveProjectMockHome: () => ${JSON.stringify(mockedProjectMockHome)}
    }
  }

  if (request === './loader' && parent?.filename === entryPath) {
    const fs = require('node:fs')
    const path = require('node:path')
    process.stdout.write(JSON.stringify({
      workspaceFolder: process.env.__ONEWORKS_PROJECT_WORKSPACE_FOLDER__,
      workspaceFolderResolveCwd: process.env.__ONEWORKS_PROJECT_WORKSPACE_FOLDER_RESOLVE_CWD__,
      packageDir: process.env.__ONEWORKS_PROJECT_PACKAGE_DIR__,
      realHome: process.env.__ONEWORKS_PROJECT_REAL_HOME__,
      home: process.env.HOME,
      gitConfigLink: fs.readlinkSync(path.join(process.env.HOME, '.gitconfig')),
      gitConfigDirLink: fs.readlinkSync(path.join(process.env.HOME, '.config/git')),
      sourceEntry: process.env.__ONEWORKS_PROJECT_CLI_BIN_SOURCE_ENTRY__,
      distEntry: process.env.__ONEWORKS_PROJECT_CLI_BIN_DIST_ENTRY__
    }))
    return {}
  }

  return originalLoad.call(this, request, parent, isMain)
}

require(entryPath).runCliPackageEntrypoint({
  packageDir: ${JSON.stringify(packageDir)},
  sourceEntry: './src/custom-cli',
  distEntry: './dist/custom-cli.js'
})
      `
      ],
      {
        cwd: nestedCwd,
        env: {
          ...process.env,
          HOME: realHome
        },
        encoding: 'utf8'
      }
    )

    expect(result.status).toBe(0)
    expect(result.signal).toBeNull()
    expect(result.stderr).toBe('')
    expect(JSON.parse(result.stdout)).toEqual({
      workspaceFolder: realWorkspaceDir,
      workspaceFolderResolveCwd: realWorkspaceDir,
      packageDir,
      realHome,
      home: mockedProjectMockHome,
      gitConfigLink: resolve(realHome, '.gitconfig'),
      gitConfigDirLink: resolve(realHome, '.config/git'),
      sourceEntry: './src/custom-cli',
      distEntry: './dist/custom-cli.js'
    })
  })

  it('clears inherited exact project-home env when bootstrapping another workspace', async () => {
    const workspaceDir = await mkdtemp(resolve(tmpdir(), 'ow-cli-helper-entry-scope-'))
    const inheritedWorkspaceDir = await mkdtemp(resolve(tmpdir(), 'ow-cli-helper-inherited-'))
    const packageDir = resolve(workspaceDir, 'packages/fake-cli')
    tempDirs.push(workspaceDir, inheritedWorkspaceDir)

    await mkdir(packageDir, { recursive: true })
    await writeFile(resolve(workspaceDir, '.oo.config.json'), '{}\n')
    const realWorkspaceDir = await realpath(workspaceDir)
    const mockedProjectMockHome = resolve(realWorkspaceDir, '.oneworks/projects/mock-project/.mock')
    const entryPath = resolve(process.cwd(), 'packages/cli-helper/entry.js')
    const result = spawnSync(
      process.execPath,
      [
        '-e',
        `
const Module = require('node:module')
const entryPath = ${JSON.stringify(entryPath)}
const originalLoad = Module._load

Module._load = function(request, parent, isMain) {
  if (request === '@oneworks/register/dotenv') {
    return {
      migrateProjectHomeSegmentsSync: () => [],
      resolveProjectWorkspaceFolder: () => ${JSON.stringify(realWorkspaceDir)},
      resolveProjectMockHome: () => ${JSON.stringify(mockedProjectMockHome)}
    }
  }

  if (request === './loader' && parent?.filename === entryPath) {
    process.stdout.write(JSON.stringify({
      workspaceFolder: process.env.__ONEWORKS_PROJECT_WORKSPACE_FOLDER__,
      workspaceFolderResolveCwd: process.env.__ONEWORKS_PROJECT_WORKSPACE_FOLDER_RESOLVE_CWD__,
      primaryWorkspace: process.env.__ONEWORKS_PROJECT_PRIMARY_WORKSPACE_FOLDER__,
      exactProjectHome: process.env.__ONEWORKS_PROJECT_HOME_PROJECT_DIR__
    }))
    return {}
  }

  return originalLoad.call(this, request, parent, isMain)
}

require(entryPath).runCliPackageEntrypoint({
  packageDir: ${JSON.stringify(packageDir)}
})
      `
      ],
      {
        cwd: workspaceDir,
        env: {
          ...process.env,
          __ONEWORKS_PROJECT_WORKSPACE_FOLDER__: inheritedWorkspaceDir,
          __ONEWORKS_PROJECT_PRIMARY_WORKSPACE_FOLDER__: inheritedWorkspaceDir,
          __ONEWORKS_PROJECT_HOME_PROJECT_DIR__: 'inherited-home'
        },
        encoding: 'utf8'
      }
    )

    expect(result.status).toBe(0)
    expect(result.signal).toBeNull()
    expect(result.stderr).toBe('')
    expect(JSON.parse(result.stdout)).toEqual({
      workspaceFolder: realWorkspaceDir,
      workspaceFolderResolveCwd: realWorkspaceDir
    })
  })

  it('uses the ai base dir relative to the env file when linking mock-home git config', async () => {
    const workspaceDir = await mkdtemp(resolve(tmpdir(), 'ow-cli-helper-ai-base-'))
    const targetDir = resolve(workspaceDir, 'business_modules/Miniapp')
    const packageDir = resolve(workspaceDir, 'packages/fake-cli')
    const realHome = await mkdtemp(resolve(tmpdir(), 'ow-cli-helper-real-home-'))
    tempDirs.push(workspaceDir, realHome)

    await mkdir(targetDir, { recursive: true })
    await mkdir(packageDir, { recursive: true })
    await writeFile(resolve(workspaceDir, '.oo.config.json'), '{}\n')
    await writeFile(resolve(realHome, '.gitconfig'), '[user]\\n\\tname = real\\n')
    await writeFile(
      resolve(targetDir, '.env'),
      [
        '__ONEWORKS_PROJECT_WORKSPACE_FOLDER__=../..',
        '__ONEWORKS_PROJECT_CONFIG_DIR__=.',
        '__ONEWORKS_PROJECT_BASE_DIR__=.iac/ai'
      ].join('\n')
    )
    const realWorkspaceDir = await realpath(workspaceDir)
    const realTargetDir = await realpath(targetDir)

    const entryPath = resolve(process.cwd(), 'packages/cli-helper/entry.js')
    const result = spawnSync(
      process.execPath,
      [
        '-e',
        `
const Module = require('node:module')
const entryPath = ${JSON.stringify(entryPath)}
const originalLoad = Module._load

Module._load = function(request, parent, isMain) {
  if (request === './loader' && parent?.filename === entryPath) {
    const fs = require('node:fs')
    const path = require('node:path')
    process.stdout.write(JSON.stringify({
      workspaceFolder: process.env.__ONEWORKS_PROJECT_WORKSPACE_FOLDER__,
      configDir: process.env.__ONEWORKS_PROJECT_CONFIG_DIR__,
      aiBaseDir: process.env.__ONEWORKS_PROJECT_BASE_DIR__,
      aiBaseDirSourceCwd: process.env.__ONEWORKS_PROJECT_BASE_DIR_RESOLVE_CWD__,
      home: process.env.HOME,
      gitConfigLink: fs.readlinkSync(path.join(process.env.HOME, '.gitconfig'))
    }))
    return {}
  }

  return originalLoad.call(this, request, parent, isMain)
}

require(entryPath).runCliPackageEntrypoint({
  packageDir: ${JSON.stringify(packageDir)}
})
      `
      ],
      {
        cwd: workspaceDir,
        env: {
          ...process.env,
          HOME: realHome,
          __ONEWORKS_PROJECT_CONFIG_DIR__: 'business_modules/Miniapp'
        },
        encoding: 'utf8'
      }
    )

    expect(result.status).toBe(0)
    expect(result.signal).toBeNull()
    expect(result.stderr).toBe('')
    expect(JSON.parse(result.stdout)).toMatchObject({
      workspaceFolder: realWorkspaceDir,
      configDir: realTargetDir,
      aiBaseDir: '.iac/ai',
      aiBaseDirSourceCwd: realTargetDir,
      home: expect.stringMatching(/^.*\/\.oneworks\/projects\/[^/]+\/\.mock$/),
      gitConfigLink: resolve(realHome, '.gitconfig')
    })
  })

  it('bridges real-home entries without backfilling legacy mock-home files', async () => {
    const workspaceDir = await mkdtemp(resolve(tmpdir(), 'ow-cli-helper-migrate-'))
    const realHome = await mkdtemp(resolve(tmpdir(), 'ow-cli-helper-migrate-home-'))
    tempDirs.push(workspaceDir, realHome)

    const nestedCwd = resolve(workspaceDir, 'packages/demo/src')
    const packageDir = resolve(workspaceDir, 'packages/fake-cli')
    await mkdir(nestedCwd, { recursive: true })
    await mkdir(packageDir, { recursive: true })
    await mkdir(resolve(workspaceDir, '.oo', '.mock', '.codex'), { recursive: true })
    await mkdir(resolve(realHome, '.codex'), { recursive: true })
    await writeFile(resolve(workspaceDir, '.oo.config.json'), '{}\n')
    await writeFile(resolve(workspaceDir, '.oo', '.mock', '.codex', 'config.toml'), 'model = "legacy"\n')
    await writeFile(resolve(realHome, '.codex', 'config.toml'), 'model = "real"\n')

    const entryPath = resolve(process.cwd(), 'packages/cli-helper/entry.js')
    const result = spawnSync(
      process.execPath,
      [
        '-e',
        `
const Module = require('node:module')
const entryPath = ${JSON.stringify(entryPath)}
const originalLoad = Module._load

Module._load = function(request, parent, isMain) {
  if (request === './loader' && parent?.filename === entryPath) {
    const fs = require('node:fs')
    const path = require('node:path')
    const configPath = path.join(process.env.HOME, '.codex', 'config.toml')
    process.stdout.write(JSON.stringify({
      content: fs.readFileSync(configPath, 'utf8'),
      isSymlink: fs.lstatSync(configPath).isSymbolicLink()
    }))
    return {}
  }

  return originalLoad.call(this, request, parent, isMain)
}

require(entryPath).runCliPackageEntrypoint({
  packageDir: ${JSON.stringify(packageDir)}
})
      `
      ],
      {
        cwd: nestedCwd,
        env: {
          ...process.env,
          HOME: realHome,
          __ONEWORKS_PROJECT_HOME_PROJECTS_DIR__: resolve(workspaceDir, '.oneworks-projects')
        },
        encoding: 'utf8'
      }
    )

    expect(result.status).toBe(0)
    expect(result.signal).toBeNull()
    expect(result.stderr).toBe('')
    expect(JSON.parse(result.stdout)).toEqual({
      content: 'model = "real"\n',
      isSymlink: true
    })
  })

  it('bootstraps NODE_PATH from package resolution paths', async () => {
    const workspaceDir = await mkdtemp(resolve(tmpdir(), 'ow-cli-helper-node-path-'))
    tempDirs.push(workspaceDir)

    const packageDir = resolve(workspaceDir, 'vendor/fake-cli')
    const dependencyDir = resolve(workspaceDir, 'vendor/node_modules/dep')
    await mkdir(packageDir, { recursive: true })
    await mkdir(dependencyDir, { recursive: true })
    await writeFile(resolve(dependencyDir, 'package.json'), JSON.stringify({ name: 'dep', version: '1.0.0' }))
    const resolvedDependencyPackageJson = await realpath(resolve(dependencyDir, 'package.json'))
    const resolvedVendorNodeModules = await realpath(resolve(workspaceDir, 'vendor/node_modules'))

    const entryPath = resolve(packageDir, 'entry.js')
    await writeFile(
      entryPath,
      `const { createRequire } = require('node:module')
const { resolve } = require('node:path')
const workspaceRequire = createRequire(resolve(process.cwd(), '__workspace_probe__.cjs'))
process.stdout.write(JSON.stringify({
  nodePath: process.env.NODE_PATH,
  resolved: workspaceRequire.resolve('dep/package.json')
}))
`
    )

    const result = spawnSync(
      process.execPath,
      [resolve(process.cwd(), 'packages/cli-helper/loader.js')],
      {
        cwd: workspaceDir,
        env: {
          ...process.env,
          NODE_PATH: '',
          __ONEWORKS_PROJECT_PACKAGE_DIR__: packageDir,
          __ONEWORKS_PROJECT_CLI_BIN_SOURCE_ENTRY__: entryPath
        },
        encoding: 'utf8'
      }
    )

    expect(result.status).toBe(0)
    expect(result.signal).toBeNull()
    expect(result.stderr).toBe('')

    const output = JSON.parse(result.stdout) as { nodePath: string; resolved: string }
    const normalizedNodePathEntries = await Promise.all(
      output.nodePath
        .split(delimiter)
        .filter(Boolean)
        .map(async entry => {
          try {
            return await realpath(entry)
          } catch {
            return entry
          }
        })
    )
    expect(output.resolved).toBe(resolvedDependencyPackageJson)
    expect(normalizedNodePathEntries).toContain(resolvedVendorNodeModules)
  })
})
