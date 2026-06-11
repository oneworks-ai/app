const macOsAppearances = ['light', 'dark', 'tinted']

const macOsSpecializations = valuesByAppearance =>
  macOsAppearances.map(appearance => ({
    appearance,
    idiom: 'macOS',
    value: valuesByAppearance[appearance]
  }))

const iconComposerDocument = ({
  darkBackgroundColor = 'srgb:0,0,0,1',
  lightBackgroundColor = darkBackgroundColor
} = {}) => {
  const darkBackgroundFill = { solid: darkBackgroundColor }
  const lightBackgroundFill = { solid: lightBackgroundColor }

  return {
    fill: lightBackgroundFill,
    'fill-specializations': macOsSpecializations({
      dark: darkBackgroundFill,
      light: lightBackgroundFill,
      tinted: lightBackgroundFill
    }),
    groups: [
      {
        layers: [
          {
            fill: 'none',
            'fill-specializations': macOsSpecializations({
              dark: 'none',
              light: 'none',
              tinted: 'none'
            }),
            glass: false,
            'image-name': 'icon.png',
            'image-name-specializations': [
              {
                appearance: 'dark',
                idiom: 'universal',
                value: 'icon-dark.png'
              }
            ],
            name: 'oneworks'
          }
        ]
      }
    ],
    'supported-platforms': {
      circles: ['watchOS'],
      squares: 'shared'
    }
  }
}

const desktopThemeManifest = ({
  macosFrameContentRatio,
  macosSquircleExponent,
  modes,
  platformIconDirs,
  sourceCommit,
  theme
}) => ({
  product: 'oneworks',
  source: 'assets/icon',
  sourceCommit,
  theme,
  type: 'desktop-icon-theme',
  files: {
    darkPng: 'dark.png',
    darkSvg: 'dark.svg',
    iconComposer: 'icon.icon/',
    lightPng: 'light.png',
    lightSvg: 'light.svg',
    platformPngDirs: platformIconDirs,
    solid: 'solid/',
    transparent: 'transparent/'
  },
  platformTransforms: {
    linux: {
      strategy: 'crop-source-content'
    },
    macos: {
      frameContentRatio: macosFrameContentRatio,
      squircleExponent: macosSquircleExponent,
      strategy: 'crop-source-content-frame-quintic-superellipse-mask'
    },
    windows: {
      strategy: 'crop-source-content'
    }
  },
  modes
})

const desktopIconsManifest = ({
  defaultTheme,
  fallbackMode,
  macosFrameContentRatio,
  macosSquircleExponent,
  modes,
  platformIconDirs,
  sourceCommit,
  sourceIconSize,
  sourceContentRatio,
  sourceSeed,
  themes
}) => ({
  product: 'oneworks',
  source: 'assets/icon',
  sourceCommit,
  sourceSeed,
  defaultTheme,
  fill: {
    cropRatio: sourceContentRatio,
    sourceSize: sourceIconSize,
    strategy: 'crop-source-content'
  },
  platformAssets: {
    fallbackPng: '{theme}/{mode}.png',
    platformPng: '{theme}/{platform}/{mode}.png',
    solidFallbackPng: '{theme}/solid/{mode}.png',
    solidPlatformPng: '{theme}/solid/{platform}/{mode}.png',
    transparentFallbackPng: '{theme}/transparent/{mode}.png',
    transparentPlatformPng: '{theme}/transparent/{platform}/{mode}.png',
    platforms: platformIconDirs
  },
  platformTransforms: {
    linux: {
      strategy: 'crop-source-content'
    },
    macos: {
      frameContentRatio: macosFrameContentRatio,
      squircleExponent: macosSquircleExponent,
      strategy: 'crop-source-content-frame-quintic-superellipse-mask'
    },
    windows: {
      strategy: 'crop-source-content'
    }
  },
  fallbackMode,
  themes,
  modes
})

module.exports = {
  desktopIconsManifest,
  desktopThemeManifest,
  iconComposerDocument
}
