import process from 'node:process'

import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

import { relayLoginDevPlugin } from './vite.relayLoginDev.js'

const relayAdminDevProxyTarget = process.env.ONEWORKS_RELAY_ADMIN_DEV_PROXY_TARGET ?? 'http://127.0.0.1:48888'

export default defineConfig(({ command }) => ({
  define: command === 'build'
    ? {
      'process.env.NODE_ENV': JSON.stringify('production')
    }
    : undefined,
  plugins: [react(), relayLoginDevPlugin(relayAdminDevProxyTarget)],
  resolve: {
    conditions: ['browser', '__oneworks__', 'module', 'import', 'development']
  },
  server: command === 'serve'
    ? {
      proxy: {
        '/api': {
          changeOrigin: true,
          target: relayAdminDevProxyTarget,
          xfwd: true
        }
      }
    }
    : undefined,
  build: {
    cssCodeSplit: false,
    emptyOutDir: true,
    lib: {
      entry: {
        admin: 'src/main.tsx',
        login: 'src/login/main.tsx'
      },
      fileName: (_format, entryName) => `${entryName}.js`,
      formats: ['es']
    },
    rollupOptions: {
      output: {
        assetFileNames: assetInfo => assetInfo.name?.endsWith('.css') === true ? 'admin.css' : '[name][extname]'
      }
    },
    target: 'es2022'
  }
}))
