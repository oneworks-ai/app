import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import https from 'node:https'

export const ONEWORKS_PACKAGE_NAME = 'oneworks'
export const ONEWORKS_CLI_PACKAGE_NAME = '@oneworks/cli'

const resolvePackageTarballBasename = (packageName: string) => {
  const segments = packageName.split('/')
  const basename = segments.at(-1)?.trim()
  if (!basename) {
    throw new Error(`Invalid npm package name: ${packageName}`)
  }
  return basename
}

export const buildNpmPackageTarballUrl = (packageName: string, version: string) => (
  `https://registry.npmjs.org/${packageName}/-/${resolvePackageTarballBasename(packageName)}-${version}.tgz`
)

export const normalizePackageNameForReleaseTag = (packageName: string) =>
  packageName.replace(/^@/, '').replace(/\//gu, '-')

export const buildPackageReleaseTagPrefix = (packageName: string) => (
  `pkg/${normalizePackageNameForReleaseTag(packageName)}/v`
)

export const buildPackageReleaseTag = (packageName: string, version: string) => (
  `${buildPackageReleaseTagPrefix(packageName)}${normalizeNpmPackageVersion(packageName, version)}`
)

export const buildOneWorksTarballUrl = (version: string) => buildNpmPackageTarballUrl(ONEWORKS_PACKAGE_NAME, version)

export const buildOneWorksCliTarballUrl = (version: string) => (
  buildNpmPackageTarballUrl(ONEWORKS_CLI_PACKAGE_NAME, version)
)

export const normalizeNpmPackageVersion = (packageName: string, value: string) => {
  const normalizedValue = value.trim()
  const packageTagPrefix = buildPackageReleaseTagPrefix(packageName)
  const version = normalizedValue.startsWith(packageTagPrefix)
    ? normalizedValue.slice(packageTagPrefix.length)
    : normalizedValue.replace(/^v/, '')
  if (!/^\d+\.\d+\.\d+(?:-[0-9a-z.-]+)?$/i.test(version)) {
    throw new Error(`Invalid ${packageName} version: ${value}`)
  }
  return version
}

export const normalizeOneWorksVersion = (value: string) => normalizeNpmPackageVersion(ONEWORKS_PACKAGE_NAME, value)

export const normalizeOneWorksCliVersion = (value: string) =>
  normalizeNpmPackageVersion(ONEWORKS_CLI_PACKAGE_NAME, value)

const download = (url: string, redirectsLeft = 5): Promise<Buffer> => (
  new Promise((resolve, reject) => {
    https.get(url, (response) => {
      const statusCode = response.statusCode ?? 0
      const location = response.headers.location

      if (statusCode >= 300 && statusCode < 400 && location != null) {
        response.resume()
        if (redirectsLeft <= 0) {
          reject(new Error(`Too many redirects while downloading ${url}`))
          return
        }
        const redirectedUrl = new URL(location, url).toString()
        download(redirectedUrl, redirectsLeft - 1).then(resolve, reject)
        return
      }

      if (statusCode < 200 || statusCode >= 300) {
        response.resume()
        reject(new Error(`Failed to download ${url}: HTTP ${statusCode}`))
        return
      }

      const chunks: Buffer[] = []
      response.on('data', (chunk: Buffer) => {
        chunks.push(chunk)
      })
      response.on('end', () => {
        resolve(Buffer.concat(chunks))
      })
    }).on('error', reject)
  })
)

export const computeUrlSha256 = async (url: string) => {
  const data = await download(url)
  return createHash('sha256').update(data).digest('hex')
}
