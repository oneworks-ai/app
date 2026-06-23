import { resolve } from 'node:path'

import { defineConfig } from 'electron-vite'

const iconSourceDir = resolve(__dirname, '../../packages/icon/src')
const configSourceDir = resolve(__dirname, '../../packages/config/src')
const coreSourceDir = resolve(__dirname, '../../packages/core/src')
const typesSourceDir = resolve(__dirname, '../../packages/types/src')
const utilsSourceDir = resolve(__dirname, '../../packages/utils/src')
const configSourceAliases = [
  { find: /^@oneworks\/config\/(.+)$/, replacement: `${configSourceDir}/$1.ts` },
  { find: /^@oneworks\/config$/, replacement: resolve(configSourceDir, 'index.ts') }
]
const coreSourceAliases = [
  { find: /^@oneworks\/core\/(.+)$/, replacement: `${coreSourceDir}/$1.ts` },
  { find: /^@oneworks\/core$/, replacement: resolve(coreSourceDir, 'index.ts') }
]
const iconSourceAliases = [
  { find: /^@oneworks\/icon\/(.+)$/, replacement: `${iconSourceDir}/$1.ts` },
  { find: /^@oneworks\/icon$/, replacement: resolve(iconSourceDir, 'index.ts') }
]
const typesSourceAliases = [
  { find: /^@oneworks\/types\/(.+)$/, replacement: `${typesSourceDir}/$1.ts` },
  { find: /^@oneworks\/types$/, replacement: resolve(typesSourceDir, 'index.ts') }
]
const utilsSourceAliases = [
  { find: /^@oneworks\/utils\/(.+)$/, replacement: `${utilsSourceDir}/$1.ts` },
  { find: /^@oneworks\/utils$/, replacement: resolve(utilsSourceDir, 'index.ts') },
  { find: /^@oneworks\/utils\/pinyin-search$/, replacement: resolve(utilsSourceDir, 'pinyin-search.ts') }
]
const workspaceSourceAliases = [
  ...configSourceAliases,
  ...coreSourceAliases,
  ...iconSourceAliases,
  ...typesSourceAliases,
  ...utilsSourceAliases
]

export default defineConfig({
  main: {
    build: {
      externalizeDeps: {
        exclude: [
          '@oneworks/config',
          '@oneworks/core',
          '@oneworks/icon',
          '@oneworks/types',
          '@oneworks/utils',
          /^@yume-chan\//,
          'pinyin-pro'
        ]
      },
      rollupOptions: {
        external: [
          'electron',
          'electron-updater',
          /^node:/
        ],
        input: resolve(__dirname, 'src/main/index.ts')
      }
    },
    resolve: {
      alias: workspaceSourceAliases,
      conditions: ['__oneworks__', 'node', 'import']
    },
    ssr: {
      noExternal: [
        '@oneworks/config',
        '@oneworks/core',
        '@oneworks/icon',
        '@oneworks/types',
        '@oneworks/utils',
        /^@yume-chan\//,
        'pinyin-pro'
      ]
    }
  },
  preload: {
    build: {
      externalizeDeps: {
        exclude: ['@paper-design/shaders', '@oneworks/icon']
      },
      rollupOptions: {
        external: [
          'electron',
          /^node:/
        ],
        input: resolve(__dirname, 'src/preload/index.ts'),
        output: {
          inlineDynamicImports: true
        }
      }
    },
    resolve: {
      alias: iconSourceAliases,
      conditions: ['__oneworks__', 'node', 'import']
    },
    ssr: {
      noExternal: ['@paper-design/shaders', '@oneworks/icon']
    }
  }
})
