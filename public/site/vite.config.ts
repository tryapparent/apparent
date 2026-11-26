import { defineConfig, type Plugin } from "vite"
import { fileURLToPath } from "node:url"
import { publicAssetPlugin } from "./lib/public-assets.mjs"
import react from "@vitejs/plugin-react"
import { agentFiles, jsonLd } from "../enablement/site-build/agent-files.ts"
import { agentRoutes } from "../enablement/artifact/agent-paths.ts"


const TYPES: Record<string, string> = { ".txt": "text/plain; charset=utf-8", ".md": "text/markdown; charset=utf-8" }


// llms.txt, llms-full.txt and skill.md at the site root, plus the JSON-LD in index.html.
function forAgents(): Plugin {
  return {
    name: "apparent-agent-files",
    transformIndexHtml: (_, context) => context.path === "/index.html"
      ? [{ tag: "script", attrs: { type: "application/ld+json" }, children: jsonLd(), injectTo: "head" }]
      : [],
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const name = req.url?.split("?")[0].slice(1) ?? ""
        if (!Object.hasOwn(TYPES, name.slice(name.lastIndexOf(".")))) return next()
        const files = agentFiles()
        const file = Object.hasOwn(files, name) ? files[name] : undefined
        if (file === undefined) return next()
        res.setHeader("Content-Type", TYPES[name.slice(name.lastIndexOf("."))])
        res.end(file)
      })
    },
    generateBundle() {
      if (this.environment?.config.build.ssr) return
      for (const [fileName, source] of Object.entries(agentFiles())) this.emitFile({ type: "asset", fileName, source })
    },
  }
}

export default defineConfig({

  publicDir: false,
  plugins: [publicAssetPlugin(fileURLToPath(new URL("./public/assets/", import.meta.url))), react(), forAgents()],
  // three.js lives in the lazily loaded hero brush chunk.
  build: {
    chunkSizeWarningLimit: 700,
    rollupOptions: {
      input: ["index.html", ...agentRoutes.map(([path]) => path).filter(path => path.endsWith(".html"))]
        .map(path => fileURLToPath(new URL(path, import.meta.url))),
    },
  },
  // Previews are shared over Tailscale (studio.*.ts.net).
  server: { allowedHosts: [".ts.net"] },
  preview: { allowedHosts: [".ts.net"] },
})
