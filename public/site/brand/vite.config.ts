import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  base: '/brand/',
  publicDir: false,
  plugins: [react()],
  resolve: { preserveSymlinks: true, dedupe: ['react', 'react-dom'] },
  build: { outDir: '../dist/brand', emptyOutDir: false },
})
