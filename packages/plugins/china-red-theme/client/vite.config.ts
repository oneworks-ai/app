import { fileURLToPath } from 'node:url'

import { defineConfig } from 'vite'

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  build: {
    copyPublicDir: false,
    emptyOutDir: true,
    lib: {
      entry: { index: fileURLToPath(new URL('./src/index.ts', import.meta.url)) },
      fileName: (_format, entryName) => `${entryName}.js`,
      formats: ['es']
    },
    minify: false,
    outDir: 'dist',
    target: 'es2022',
    rollupOptions: {
      output: {
        assetFileNames: '[name][extname]',
        chunkFileNames: '[name].js',
        entryFileNames: '[name].js'
      }
    }
  }
})
