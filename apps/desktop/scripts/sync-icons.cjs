/* eslint-disable max-lines -- centralizes desktop icon source validation, aliases, and platform outputs. */
const { Buffer } = require('node:buffer')
const { spawnSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')
const { createIcns, createIco } = require('./icon-sync/icon-containers.cjs')
const { desktopIconsManifest, desktopThemeManifest, iconComposerDocument } = require('./icon-sync/manifests.cjs')
const { readPng } = require('./icon-sync/png-codec.cjs')
const {
  filledCrop,
  writeFilledPngs,
  writeFilledPngsFromImage,
  writeMacOsPngs
} = require('./icon-sync/png-resize.cjs')

const desktopRoot = path.resolve(__dirname, '..')
const workspaceRoot = path.resolve(desktopRoot, '../..')
const iconAssetRoot = path.join(workspaceRoot, 'assets', 'icon')
const sourceIconsDir = path.join(iconAssetRoot, 'dist', 'icons')
const buildDir = path.join(desktopRoot, 'build')
const outputIconsDir = path.join(buildDir, 'icons')
const defaultTheme = 'metal'
const fallbackMode = 'dark'
const themes = ['industrial', 'metal', 'matrix']
const modes = ['light', 'dark']
const platformIconDirs = ['macos', 'windows', 'linux']
const solidBackgrounds = {
  industrial: {
    light: [255, 241, 232],
    dark: [24, 8, 4]
  },
  matrix: {
    light: [233, 255, 241],
    dark: [0, 27, 13]
  },
  metal: {
    light: [242, 244, 240],
    dark: [17, 22, 21]
  }
}
const sourceIconSize = 1024
const sourceContentRatio = 0.82
const macosFrameContentRatio = 0.82
const macosSquircleExponent = 5
const pngSizes = [16, 32, 48, 64, 128, 180, 192, 256, 300, 512, 1024]
const icoSizes = [16, 32, 48, 64, 128, 256]
const icnsSizes = [16, 32, 64, 128, 256, 512, 1024]
const colorComponent = value => (value / 255).toFixed(4).replace(/0+$/, '').replace(/\.$/, '')
const srgbColor = ([red, green, blue]) =>
  `srgb:${colorComponent(red)},${colorComponent(green)},${colorComponent(blue)},1`

const assertFile = (filePath, hint) => {
  if (fs.existsSync(filePath)) return
  throw new Error(`${hint}: ${filePath}`)
}

const readJson = filePath => JSON.parse(fs.readFileSync(filePath, 'utf8'))

const writeJson = (filePath, value) => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`)
}

const removeIfExists = (targetPath) => {
  fs.rmSync(targetPath, { force: true, recursive: true })
}

const sourceVariantDir = (theme, mode, background = 'background') => (
  path.join(sourceIconsDir, `oneworks-${theme}-${mode}-${background}`)
)

const sourcePng = (theme, mode, background = 'background') => (
  path.join(sourceVariantDir(theme, mode, background), 'png', 'icon-1024x1024.png')
)

const sourceFaviconSvg = (theme, mode, background = 'background') => (
  path.join(sourceVariantDir(theme, mode, background), 'web', 'favicon.svg')
)

const fillSvg = (source) => {
  const viewBoxMatch = source.match(/viewBox="0 0 ([0-9.]+) ([0-9.]+)"/)
  if (viewBoxMatch == null || viewBoxMatch[1] !== viewBoxMatch[2]) return source
  const size = Number(viewBoxMatch[1])
  if (!Number.isFinite(size) || size <= 0) return source

  const { cropSize, left, top } = filledCrop(size, sourceContentRatio)
  return source.replace(
    /viewBox="0 0 [0-9.]+ [0-9.]+"/,
    `viewBox="${left} ${top} ${cropSize} ${cropSize}"`
  )
}

const writeIconComposerPackage = (targetDir, {
  darkBackgroundColor,
  darkPng,
  lightBackgroundColor,
  lightPng
}) => {
  removeIfExists(targetDir)
  writeJson(
    path.join(targetDir, 'icon.json'),
    iconComposerDocument({
      darkBackgroundColor,
      lightBackgroundColor
    })
  )
  fs.mkdirSync(path.join(targetDir, 'Assets'), { recursive: true })
  fs.writeFileSync(path.join(targetDir, 'Assets', 'icon.png'), lightPng)
  fs.writeFileSync(path.join(targetDir, 'Assets', 'icon-dark.png'), darkPng)
}

const resolveSubmoduleCommit = () => {
  const result = spawnSync('git', ['-C', iconAssetRoot, 'rev-parse', 'HEAD'], {
    encoding: 'utf8',
    stdio: 'pipe'
  })
  if (result.status !== 0) return undefined
  const commit = result.stdout.trim()
  return commit === '' ? undefined : commit
}

const filledPngsByVariant = new Map()
const macOsPngsByVariant = new Map()
const solidFilledPngsByVariant = new Map()
const solidMacOsPngsByVariant = new Map()

const getFilledPngs = (theme, mode) => {
  const key = `${theme}:${mode}`
  const cached = filledPngsByVariant.get(key)
  if (cached != null) return cached

  const pngBySize = writeFilledPngs(sourcePng(theme, mode), {
    pngSizes,
    sourceContentRatio,
    sourceIconSize
  })
  filledPngsByVariant.set(key, pngBySize)
  return pngBySize
}

const getMacOsPngs = (theme, mode) => {
  const key = `${theme}:${mode}`
  const cached = macOsPngsByVariant.get(key)
  if (cached != null) return cached

  const pngBySize = writeMacOsPngs(getFilledPngs(theme, mode).get(sourceIconSize), {
    frameContentRatio: macosFrameContentRatio,
    pngSizes,
    sourceIconSize,
    squircleExponent: macosSquircleExponent
  })
  macOsPngsByVariant.set(key, pngBySize)
  return pngBySize
}

const getPlatformPngs = (theme, mode, platform) => (
  platform === 'macos'
    ? getMacOsPngs(theme, mode)
    : getFilledPngs(theme, mode)
)

const getSolidBackgroundColor = (theme, mode) => solidBackgrounds[theme]?.[mode] ?? [32, 36, 35]

const roundedRectContains = (x, y, size, radius) => {
  const innerLeft = radius
  const innerRight = size - radius
  const innerTop = radius
  const innerBottom = size - radius
  if (x >= innerLeft && x <= innerRight) return true
  if (y >= innerTop && y <= innerBottom) return true

  const centerX = x < innerLeft ? innerLeft : innerRight
  const centerY = y < innerTop ? innerTop : innerBottom
  return (x - centerX) ** 2 + (y - centerY) ** 2 <= radius ** 2
}

const roundedRectCoverage = (x, y, size, radius) => {
  const samplesPerAxis = 4
  let covered = 0
  for (let sampleY = 0; sampleY < samplesPerAxis; sampleY += 1) {
    for (let sampleX = 0; sampleX < samplesPerAxis; sampleX += 1) {
      if (
        roundedRectContains(
          x + (sampleX + 0.5) / samplesPerAxis,
          y + (sampleY + 0.5) / samplesPerAxis,
          size,
          radius
        )
      ) {
        covered += 1
      }
    }
  }
  return covered / (samplesPerAxis * samplesPerAxis)
}

const composeSolidSourceImage = (theme, mode) => {
  const sourceImage = readPng(sourcePng(theme, mode, 'transparent'))
  const [backgroundRed, backgroundGreen, backgroundBlue] = getSolidBackgroundColor(theme, mode)
  const pixels = Buffer.alloc(sourceImage.width * sourceImage.height * 4)
  const radius = sourceImage.width * (28 / 260)

  for (let index = 0; index < pixels.length; index += 4) {
    const pixelIndex = index / 4
    const x = pixelIndex % sourceImage.width
    const y = Math.floor(pixelIndex / sourceImage.width)
    const alpha = sourceImage.pixels[index + 3] / 255
    const backgroundAlpha = roundedRectCoverage(x, y, sourceImage.width, radius)
    const outputAlpha = alpha + backgroundAlpha * (1 - alpha)

    if (outputAlpha <= 0) {
      pixels[index] = 0
      pixels[index + 1] = 0
      pixels[index + 2] = 0
      pixels[index + 3] = 0
      continue
    }

    pixels[index] = Math.round(
      (sourceImage.pixels[index] * alpha + backgroundRed * backgroundAlpha * (1 - alpha)) / outputAlpha
    )
    pixels[index + 1] = Math.round(
      (sourceImage.pixels[index + 1] * alpha + backgroundGreen * backgroundAlpha * (1 - alpha)) / outputAlpha
    )
    pixels[index + 2] = Math.round(
      (sourceImage.pixels[index + 2] * alpha + backgroundBlue * backgroundAlpha * (1 - alpha)) / outputAlpha
    )
    pixels[index + 3] = Math.round(outputAlpha * 255)
  }

  return {
    height: sourceImage.height,
    pixels,
    width: sourceImage.width
  }
}

const getSolidFilledPngs = (theme, mode) => {
  const key = `${theme}:${mode}`
  const cached = solidFilledPngsByVariant.get(key)
  if (cached != null) return cached

  const pngBySize = writeFilledPngsFromImage(composeSolidSourceImage(theme, mode), {
    pngSizes,
    sourceContentRatio,
    sourceIconSize
  })
  solidFilledPngsByVariant.set(key, pngBySize)
  return pngBySize
}

const getSolidMacOsPngs = (theme, mode) => {
  const key = `${theme}:${mode}`
  const cached = solidMacOsPngsByVariant.get(key)
  if (cached != null) return cached

  const pngBySize = writeMacOsPngs(getSolidFilledPngs(theme, mode).get(sourceIconSize), {
    frameContentRatio: macosFrameContentRatio,
    pngSizes,
    sourceIconSize,
    squircleExponent: macosSquircleExponent
  })
  solidMacOsPngsByVariant.set(key, pngBySize)
  return pngBySize
}

const getSolidPlatformPngs = (theme, mode, platform) => (
  platform === 'macos'
    ? getSolidMacOsPngs(theme, mode)
    : getSolidFilledPngs(theme, mode)
)

const writeFilledSvg = (sourcePath, targetPath) => {
  assertFile(sourcePath, 'Icon SVG asset source is missing')
  fs.mkdirSync(path.dirname(targetPath), { recursive: true })
  fs.writeFileSync(targetPath, fillSvg(fs.readFileSync(sourcePath, 'utf8')))
}

const writeTransparentRuntimeAssets = (themeDir, theme, mode) => {
  const sourcePngPath = sourcePng(theme, mode, 'transparent')
  assertFile(sourcePngPath, `Missing ${theme}/${mode} transparent PNG icon asset`)

  const transparentDir = path.join(themeDir, 'transparent')
  fs.mkdirSync(transparentDir, { recursive: true })
  fs.writeFileSync(path.join(transparentDir, `${mode}.png`), fs.readFileSync(sourcePngPath))

  for (const platform of platformIconDirs) {
    const platformDir = path.join(transparentDir, platform)
    fs.mkdirSync(platformDir, { recursive: true })
    fs.writeFileSync(path.join(platformDir, `${mode}.png`), fs.readFileSync(sourcePngPath))
  }

  writeFilledSvg(sourceFaviconSvg(theme, mode, 'transparent'), path.join(transparentDir, `${mode}.svg`))
}

const writeSolidRuntimeAssets = (themeDir, theme, mode) => {
  const solidDir = path.join(themeDir, 'solid')
  fs.mkdirSync(solidDir, { recursive: true })
  fs.writeFileSync(path.join(solidDir, `${mode}.png`), getSolidFilledPngs(theme, mode).get(sourceIconSize))

  for (const platform of platformIconDirs) {
    const platformDir = path.join(solidDir, platform)
    fs.mkdirSync(platformDir, { recursive: true })
    fs.writeFileSync(
      path.join(platformDir, `${mode}.png`),
      getSolidPlatformPngs(theme, mode, platform).get(sourceIconSize)
    )
  }
}

const syncTheme = (theme) => {
  const themeDir = path.join(outputIconsDir, theme)
  removeIfExists(themeDir)

  for (const mode of modes) {
    fs.mkdirSync(themeDir, { recursive: true })
    fs.writeFileSync(path.join(themeDir, `${mode}.png`), getFilledPngs(theme, mode).get(sourceIconSize))
    for (const platform of platformIconDirs) {
      const platformDir = path.join(themeDir, platform)
      fs.mkdirSync(platformDir, { recursive: true })
      fs.writeFileSync(
        path.join(platformDir, `${mode}.png`),
        getPlatformPngs(theme, mode, platform).get(sourceIconSize)
      )
    }
    writeFilledSvg(sourceFaviconSvg(theme, mode), path.join(themeDir, `${mode}.svg`))
    writeSolidRuntimeAssets(themeDir, theme, mode)
    writeTransparentRuntimeAssets(themeDir, theme, mode)
  }

  writeIconComposerPackage(path.join(themeDir, 'icon.icon'), {
    darkBackgroundColor: srgbColor(solidBackgrounds[theme].dark),
    darkPng: getFilledPngs(theme, 'dark').get(sourceIconSize),
    lightBackgroundColor: srgbColor(solidBackgrounds[theme].light),
    lightPng: getFilledPngs(theme, 'light').get(sourceIconSize)
  })

  writeJson(
    path.join(themeDir, 'manifest.json'),
    desktopThemeManifest({
      modes,
      macosFrameContentRatio,
      macosSquircleExponent,
      platformIconDirs,
      sourceCommit: resolveSubmoduleCommit(),
      theme
    })
  )
}

const syncRootAliases = () => {
  const defaultMacOsPngs = getMacOsPngs(defaultTheme, fallbackMode)
  const defaultPngs = getFilledPngs(defaultTheme, fallbackMode)
  const defaultPng = defaultPngs.get(sourceIconSize)
  const defaultBackgroundColor = srgbColor(solidBackgrounds[defaultTheme][fallbackMode])
  fs.writeFileSync(path.join(buildDir, 'icon.icns'), createIcns(defaultMacOsPngs, icnsSizes))
  fs.writeFileSync(path.join(buildDir, 'icon.ico'), createIco(defaultPngs, icoSizes))
  fs.writeFileSync(path.join(buildDir, 'icon.png'), defaultPng)
  writeFilledSvg(sourceFaviconSvg(defaultTheme, fallbackMode), path.join(buildDir, 'icon.svg'))
  writeIconComposerPackage(path.join(buildDir, 'icon.icon'), {
    darkBackgroundColor: defaultBackgroundColor,
    darkPng: defaultPng,
    lightBackgroundColor: defaultBackgroundColor,
    lightPng: defaultPng
  })
}

const main = () => {
  assertFile(
    path.join(iconAssetRoot, 'package.json'),
    'Icon asset submodule is missing. Run `git submodule update --init assets/icon`'
  )
  assertFile(
    path.join(sourceIconsDir, 'manifest.json'),
    'Generated icon assets are missing from the icon submodule'
  )

  const rootManifest = readJson(path.join(sourceIconsDir, 'manifest.json'))
  removeIfExists(outputIconsDir)
  for (const theme of themes) {
    for (const mode of modes) {
      assertFile(sourcePng(theme, mode), `Missing ${theme}/${mode} PNG icon asset`)
      assertFile(sourcePng(theme, mode, 'transparent'), `Missing ${theme}/${mode} transparent PNG icon asset`)
    }
    syncTheme(theme)
  }
  syncRootAliases()

  writeJson(
    path.join(outputIconsDir, 'manifest.json'),
    desktopIconsManifest({
      defaultTheme,
      fallbackMode,
      modes,
      macosFrameContentRatio,
      macosSquircleExponent,
      platformIconDirs,
      sourceCommit: resolveSubmoduleCommit(),
      sourceIconSize,
      sourceContentRatio,
      sourceSeed: rootManifest.seed,
      themes
    })
  )

  console.log(`[desktop] synced icon assets from assets/icon to ${path.relative(workspaceRoot, buildDir)}`)
}

main()
