/* eslint-disable node/prefer-global/process -- deterministic repository asset synchronization. */
const { createHash } = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const { readPng } = require('../apps/desktop/scripts/icon-sync/png-codec.cjs')
const { writeFilledPngsFromImage } = require('../apps/desktop/scripts/icon-sync/png-resize.cjs')

const root = path.resolve(__dirname, '..')
const canonicalBrandProfilePath = path.join(root, 'packages', 'icon', 'brand-profile.json')
const canonicalBrandProfile = JSON.parse(fs.readFileSync(canonicalBrandProfilePath, 'utf8'))
const defaultTheme = canonicalBrandProfile.defaultTheme
const desktopDefaultTheme = path.join(root, 'apps', 'desktop', 'build', 'icons', defaultTheme)
const distributionDir = path.join(root, 'assets', 'brand', 'distribution')
const defaultIcon = (surface, mode, extension) => (
  `apps/desktop/build/icons/${defaultTheme}/${surface}/${mode}.${extension}`
)

const copy = (source, target) => {
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.copyFileSync(path.join(root, source), path.join(root, target))
}

const copies = [
  ['packages/icon/brand-profile.json', 'assets/icon/brand-profile.json'],
  ['packages/icon/brand-profile.json', 'assets/homepage/packages/icon/brand-profile.json'],
  [defaultIcon('transparent', 'light', 'svg'), 'apps/client/public/favicon-linear-light.svg'],
  [defaultIcon('transparent', 'dark', 'svg'), 'apps/client/public/favicon-linear-dark.svg'],
  [defaultIcon('transparent', 'light', 'png'), 'apps/client/public/favicon-linear-light.png'],
  [defaultIcon('transparent', 'dark', 'png'), 'apps/client/public/favicon-linear-dark.png'],
  [defaultIcon('transparent', 'light', 'svg'), 'assets/pwa/assets/favicon-linear-light.svg'],
  [defaultIcon('transparent', 'dark', 'svg'), 'assets/pwa/assets/favicon-linear-dark.svg'],
  [defaultIcon('transparent', 'light', 'svg'), 'apps/client/public/favicon.svg'],
  [defaultIcon('solid', 'light', 'png'), 'apps/client/public/apple-touch-icon.png'],
  [defaultIcon('solid', 'light', 'png'), 'apps/client/public/pwa-icon-192.png'],
  [defaultIcon('solid', 'light', 'png'), 'apps/client/public/pwa-icon-512.png'],
  [defaultIcon('transparent', 'light', 'svg'), 'assets/homepage/apps/homepage/src/assets/brand/favicon-linear-light-transparent.svg'],
  [defaultIcon('transparent', 'dark', 'svg'), 'assets/homepage/apps/homepage/src/assets/brand/favicon-linear-dark-transparent.svg'],
  [defaultIcon('transparent', 'light', 'png'), 'assets/homepage/apps/homepage/src/assets/brand/favicon-linear-light-transparent.png'],
  [defaultIcon('transparent', 'dark', 'png'), 'assets/homepage/apps/homepage/src/assets/brand/favicon-linear-dark-transparent.png'],
  [defaultIcon('solid', 'light', 'png'), 'assets/homepage/apps/homepage/src/assets/brand/apple-touch-icon.png'],
  [defaultIcon('solid', 'light', 'png'), 'assets/homepage/apps/homepage/src/assets/brand/app-icon-512.png'],
  [defaultIcon('solid', 'dark', 'png'), 'assets/homepage/apps/homepage/src/assets/brand/app-icon-dark-512.png'],
  ['assets/brand/distribution/npm-readme-header-light.png', 'apps/bootstrap/assets/npm-readme-header-light.png'],
  ['assets/brand/distribution/npm-readme-header-dark.png', 'apps/bootstrap/assets/npm-readme-header-dark.png'],
  ['assets/brand/distribution/vscode-marketplace-light.png', 'apps/vscode-extension/assets/vscode-marketplace-light.png'],
  ['assets/brand/distribution/vscode-marketplace-dark.png', 'apps/vscode-extension/assets/vscode-marketplace-dark.png'],
  ['assets/brand/distribution/github-org-readme-light.png', 'assets/github-profile/profile/brand-header-light.png'],
  ['assets/brand/distribution/github-org-readme-dark.png', 'assets/github-profile/profile/brand-header-dark.png'],
  [
    'assets/brand/distribution/homepage-open-graph-light.png',
    'assets/homepage/apps/homepage/src/assets/social/social-card.png'
  ],
  [
    'assets/brand/distribution/chrome-web-store-light.png',
    'packages/plugins/external-browser-driver/assets/chrome-web-store-light.png'
  ],
  [
    'assets/brand/distribution/chrome-web-store-dark.png',
    'packages/plugins/external-browser-driver/assets/chrome-web-store-dark.png'
  ],
  [defaultIcon('transparent', 'light', 'svg'), 'assets/icon/favicon-linear-light.svg'],
  [defaultIcon('transparent', 'dark', 'svg'), 'assets/icon/favicon-linear-dark.svg'],
  [`apps/desktop/build/icons/${canonicalBrandProfile.relayProfiles.cloudflare}/transparent/light.svg`, 'apps/relay-admin/public/favicon-cloudflare-light.svg'],
  [`apps/desktop/build/icons/${canonicalBrandProfile.relayProfiles.cloudflare}/transparent/dark.svg`, 'apps/relay-admin/public/favicon-cloudflare-dark.svg'],
  [`apps/desktop/build/icons/${canonicalBrandProfile.relayProfiles.vercel}/transparent/light.svg`, 'apps/relay-admin/public/favicon-vercel-light.svg'],
  [`apps/desktop/build/icons/${canonicalBrandProfile.relayProfiles.vercel}/transparent/dark.svg`, 'apps/relay-admin/public/favicon-vercel-dark.svg'],
  [
    defaultIcon('transparent', 'light', 'png'),
    'apps/android/app/src/main/res/drawable-nodpi/ic_launcher_foreground.png'
  ],
  [
    defaultIcon('transparent', 'dark', 'png'),
    'apps/android/app/src/main/res/drawable-night-nodpi/ic_launcher_foreground.png'
  ],
  ['apps/desktop/build/icon.svg', 'assets/demo-video/assets/adapter-promo/sources/oneworks.svg']
]

if (!fs.existsSync(desktopDefaultTheme)) {
  throw new Error(`Canonical ${defaultTheme} assets are missing: ${desktopDefaultTheme}`)
}

for (const [source, target] of copies) copy(source, target)

const demoVideoIconSource = path.join(root, 'assets/demo-video/assets/adapter-promo/sources/oneworks.svg')
const demoVideoIconTarget = path.join(root, 'assets/demo-video/assets/adapter-promo/icons/oneworks.png')
if (fs.existsSync(demoVideoIconSource)) {
  const { spawnSync } = require('node:child_process')
  const result = spawnSync('sips', [
    '-s', 'format', 'png', '-z', '512', '512', demoVideoIconSource, '--out', demoVideoIconTarget
  ], { stdio: 'ignore' })
  if (result.status !== 0) throw new Error('Unable to render the demo-video One Works icon with sips.')
}

const resizedCopies = [
  ['apps/client/public/favicon-linear-light.png', 300],
  ['apps/client/public/favicon-linear-dark.png', 300],
  ['apps/client/public/apple-touch-icon.png', 180],
  ['apps/client/public/pwa-icon-192.png', 192],
  ['apps/client/public/pwa-icon-512.png', 512],
  ['assets/homepage/apps/homepage/src/assets/brand/favicon-linear-light-transparent.png', 300],
  ['assets/homepage/apps/homepage/src/assets/brand/favicon-linear-dark-transparent.png', 300],
  ['assets/homepage/apps/homepage/src/assets/brand/apple-touch-icon.png', 180],
  ['assets/homepage/apps/homepage/src/assets/brand/app-icon-512.png', 512],
  ['assets/homepage/apps/homepage/src/assets/brand/app-icon-dark-512.png', 512]
]

for (const [target, size] of resizedCopies) {
  const targetPath = path.join(root, target)
  const source = readPng(targetPath)
  const resized = writeFilledPngsFromImage(source, {
    pngSizes: [size],
    sourceContentRatio: 1,
    sourceIconSize: source.width
  }).get(size)
  fs.writeFileSync(targetPath, resized)
}

const chromeStoreTileTarget = path.join(
  root,
  'packages/plugins/external-browser-driver/store-assets/small-promo-tile.png'
)
const chromeStoreSource = path.join(distributionDir, 'chrome-web-store-light.png')
const { spawnSync } = require('node:child_process')
const chromeStoreResult = spawnSync('sips', [
  '-s', 'format', 'png', '-z', '220', '440', '-p', '280', '440', '--padColor', 'f7f9fb',
  chromeStoreSource, '--out', chromeStoreTileTarget
], { stdio: 'ignore' })
if (chromeStoreResult.status !== 0) throw new Error('Unable to render the Chrome Web Store promo tile with sips.')

const manifestPath = path.join(root, 'assets', 'brand', 'brand-assets.manifest.json')
const distributionFiles = fs.readdirSync(distributionDir, { withFileTypes: true })
  .filter(entry => entry.isFile())
  .map(entry => path.posix.join('assets/brand/distribution', entry.name))
const files = [...new Set([
  ...copies.map(([, target]) => target),
  'assets/demo-video/assets/adapter-promo/icons/oneworks.png',
  'packages/plugins/external-browser-driver/store-assets/small-promo-tile.png',
  ...distributionFiles
])].filter(file => fs.existsSync(path.join(root, file))).sort()
const manifest = {
  schemaVersion: 1,
  defaultTheme,
  source: `apps/desktop/build/icons/${defaultTheme}`,
  files: files.map(file => ({
    path: file,
    sha256: createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex')
  }))
}
fs.mkdirSync(path.dirname(manifestPath), { recursive: true })
fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
console.log(`[brand] synchronized ${copies.length} Linear assets`)
