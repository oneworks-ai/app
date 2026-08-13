import { fileURLToPath } from 'node:url'

import { defineConfig } from 'vite'

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  esbuild: { jsxFactory: 'h' },
  resolve: {
    conditions: ['browser', '__oneworks__', 'module', 'import', 'development']
  },
  build: {
    copyPublicDir: false,
    emptyOutDir: true,
    lib: {
      entry: fileURLToPath(new URL('./src/index.tsx', import.meta.url)),
      fileName: () => 'index.js',
      formats: ['es']
    },
    minify: false,
    outDir: 'dist',
    target: 'es2022'
  }
})
