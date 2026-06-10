import type { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { mkdir, unlink } from 'node:fs/promises'
import https from 'node:https'
import path from 'node:path'
import process from 'node:process'

import { createBootstrapProgress } from './progress'

interface GitHubReleaseAsset {
  browser_download_url?: string
  digest?: string
  name: string
  url: string
}

interface GitHubReleaseResponse {
  assets?: GitHubReleaseAsset[]
  draft?: boolean
  tag_name?: string
  tagName?: string
}

export interface DesktopRelease {
  assets: GitHubReleaseAsset[]
  tagName: string
}

const GITHUB_RELEASES_API = 'https://api.github.com/repos/oneworks-ai/app/releases'
const DESKTOP_RELEASE_TAG_PREFIX = 'pkg/oneworks-desktop/v'
const RELEASE_TAG_OVERRIDE = process.env.ONEWORKS_BOOTSTRAP_DESKTOP_RELEASE_TAG?.trim()

const ensureDirectory = async (targetPath: string) => {
  await mkdir(targetPath, { recursive: true })
}

const parseContentLength = (value: string | string[] | undefined) => {
  const rawValue = Array.isArray(value) ? value[0] : value
  if (rawValue == null) return undefined

  const parsed = Number.parseInt(rawValue, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined
}

const requestJson = async <T>(url: string) => (
  await new Promise<T>((resolve, reject) => {
    https.get(url, {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'oneworks'
      }
    }, (response) => {
      const statusCode = response.statusCode ?? 0
      if (statusCode < 200 || statusCode >= 300) {
        response.resume()
        reject(new Error(`GitHub API request failed: HTTP ${statusCode}`))
        return
      }

      let content = ''
      response.setEncoding('utf8')
      response.on('data', (chunk: string) => {
        content += chunk
      })
      response.on('end', () => {
        try {
          resolve(JSON.parse(content) as T)
        } catch (error) {
          reject(error)
        }
      })
    }).on('error', reject)
  })
)

export const fetchDesktopRelease = async (): Promise<DesktopRelease> => {
  const release = RELEASE_TAG_OVERRIDE
    ? await requestJson<GitHubReleaseResponse>(
      `${GITHUB_RELEASES_API}/tags/${encodeURIComponent(RELEASE_TAG_OVERRIDE)}`
    )
    : (await requestJson<GitHubReleaseResponse[]>(`${GITHUB_RELEASES_API}?per_page=50`))
      .find(item => (
        item.draft !== true &&
        typeof item.tag_name === 'string' &&
        item.tag_name.startsWith(DESKTOP_RELEASE_TAG_PREFIX) &&
        /^\d+\.\d+\.\d+$/u.test(item.tag_name.slice(DESKTOP_RELEASE_TAG_PREFIX.length))
      ))
  const tagName = release?.tag_name ?? release?.tagName
  if (!tagName || !Array.isArray(release?.assets)) {
    throw new Error('Invalid desktop release metadata returned by GitHub.')
  }
  return {
    assets: release.assets.map(asset => ({
      ...asset,
      url: asset.browser_download_url ?? asset.url
    })),
    tagName
  }
}

export const selectDesktopAsset = (release: DesktopRelease, runtime: {
  arch: string
  platform: NodeJS.Platform
}) => {
  if (runtime.platform === 'darwin') {
    return release.assets.find(asset => asset.name.endsWith(`-mac-${runtime.arch}.zip`))
  }

  if (runtime.platform === 'linux') {
    const appImageArch = runtime.arch === 'x64' ? 'x86_64' : runtime.arch
    return release.assets.find(asset => asset.name.endsWith(`-linux-${appImageArch}.AppImage`))
  }

  if (runtime.platform === 'win32') {
    return release.assets.find(asset => asset.name.endsWith(`-win-${runtime.arch}.exe`))
  }

  return undefined
}

export const downloadReleaseAsset = async (asset: GitHubReleaseAsset, destinationPath: string) => {
  await ensureDirectory(path.dirname(destinationPath))

  return await new Promise<void>((resolve, reject) => {
    const hash = createHash('sha256')
    const file = createWriteStream(destinationPath)
    let downloadedBytes = 0
    let progress: ReturnType<typeof createBootstrapProgress> | undefined

    file.on('error', (error) => {
      progress?.fail(`failed to download ${asset.name}`)
      reject(error)
    })

    const request = https.get(asset.url, {
      headers: {
        'User-Agent': 'oneworks'
      }
    }, (response) => {
      const statusCode = response.statusCode ?? 0
      const redirectLocation = response.headers.location

      if (statusCode >= 300 && statusCode < 400 && redirectLocation != null) {
        file.close()
        void unlink(destinationPath).catch(() => {})
        downloadReleaseAsset({
          ...asset,
          url: new URL(redirectLocation, asset.url).toString()
        }, destinationPath).then(resolve, reject)
        return
      }

      if (statusCode < 200 || statusCode >= 300) {
        response.resume()
        file.close()
        reject(new Error(`Failed to download ${asset.name}: HTTP ${statusCode}`))
        return
      }

      progress = createBootstrapProgress({
        label: `downloading ${asset.name}`,
        total: parseContentLength(response.headers['content-length'])
      })

      response.on('data', (chunk: Buffer) => {
        downloadedBytes += chunk.length
        hash.update(chunk)
        progress?.update(downloadedBytes)
      })
      response.on('error', (error) => {
        progress?.fail(`failed to download ${asset.name}`)
        file.close()
        reject(error)
      })
      response.pipe(file)
      file.on('finish', () => {
        file.close(() => {
          const expectedDigest = asset.digest?.replace(/^sha256:/, '')
          if (expectedDigest && hash.digest('hex') !== expectedDigest) {
            progress?.fail(`failed to verify ${asset.name}`)
            reject(new Error(`Downloaded desktop asset digest mismatch for ${asset.name}.`))
            return
          }

          progress?.finish(`downloaded ${asset.name}`)
          resolve()
        })
      })
    })

    request.on('error', (error) => {
      progress?.fail(`failed to download ${asset.name}`)
      file.close()
      reject(error)
    })
  })
}
