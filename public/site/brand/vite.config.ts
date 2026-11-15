import { defineConfig } from 'vite'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  base: '/brand/',
  publicDir: false,
  build: { outDir: '../dist/brand', emptyOutDir: false },
})
