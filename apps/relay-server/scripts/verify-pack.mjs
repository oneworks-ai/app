import { execFileSync } from 'node:child_process'
import { access, mkdir, mkdtemp, readdir, rename, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const temporaryRoot = await mkdtemp(join(tmpdir(), 'oneworks-relay-server-pack-'))
const tarballDir = join(temporaryRoot, 'tarballs')
const installRoot = join(temporaryRoot, 'install')
const installedPackageDir = join(installRoot, 'node_modules', '@oneworks', 'relay-server')

const linkWorkspaceDependency = async (specifier) => {
  const source = join(packageDir, 'node_modules', ...specifier.split('/'))
  const target = join(installRoot, 'node_modules', ...specifier.split('/'))
  await access(source)
  await mkdir(dirname(target), { recursive: true })
  await symlink(source, target, 'dir')
}

try {
  await mkdir(tarballDir)
  execFileSync('pnpm', ['pack', '--pack-destination', tarballDir], {
    cwd: packageDir,
    stdio: 'pipe'
  })

  const tarballs = (await readdir(tarballDir)).filter(name => name.endsWith('.tgz'))
  if (tarballs.length !== 1) {
    throw new Error(`Expected one relay-server tarball, found ${tarballs.length}.`)
  }

  await mkdir(join(installRoot, 'node_modules', '@oneworks'), { recursive: true })
  execFileSync('tar', ['-xzf', join(tarballDir, tarballs[0]), '-C', join(installRoot, 'node_modules', '@oneworks')], {
    stdio: 'pipe'
  })
  await rename(join(installRoot, 'node_modules', '@oneworks', 'package'), installedPackageDir)

  await access(join(installedPackageDir, 'src', 'cli.ts'))
  await access(join(installedPackageDir, 'dist', 'cli.js'))
  for (
    const dependency of [
      '@oneworks/cli-helper',
      '@oneworks/relay-admin',
      '@oneworks/types',
      '@simplewebauthn/server',
      'pino',
      'postgres',
      'ws'
    ]
  ) {
    await linkWorkspaceDependency(dependency)
  }

  const output = execFileSync(process.execPath, [join(installedPackageDir, 'cli.js'), '--help'], {
    cwd: temporaryRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      HOME: temporaryRoot,
      __ONEWORKS_DISABLE_MOCK_HOME_BRIDGE: '1',
      __ONEWORKS_PROJECT_REAL_HOME__: temporaryRoot
    }
  })
  if (!output.includes('Usage:\n  oneworks-relay-server')) {
    throw new Error('Installed relay-server CLI did not print help output.')
  }
} finally {
  await rm(temporaryRoot, { force: true, recursive: true })
}
