import { fileURLToPath } from 'node:url'

const input = (name: string) => fileURLToPath(new URL(`./src/${name}`, import.meta.url))

export default {
  root: fileURLToPath(new URL('.', import.meta.url)),
  esbuild: { jsxFactory: 'h' },
  build: {
    copyPublicDir: false,
    emptyOutDir: true,
    lib: {
      entry: { index: input('index.tsx'), styles: input('styles.ts'), view: input('view.tsx') },
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
}
