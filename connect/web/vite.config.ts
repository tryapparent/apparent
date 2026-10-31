import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"

export default defineConfig({
  plugins: [react()],
  build: { outDir: process.env.CONNECT_BUILD_DIR ?? "dist" },
  // Same-site production split: browser on app.*, API/auth/callback on hosted.*.
  define: { "import.meta.env.VITE_HOSTED_API_ORIGIN": JSON.stringify(process.env.VITE_HOSTED_API_ORIGIN ?? "https://hosted.tryapparent.com") },
  server: { host: "127.0.0.1", allowedHosts: [".ts.net"] },
  preview: { host: "127.0.0.1", allowedHosts: [".ts.net"] },
})
