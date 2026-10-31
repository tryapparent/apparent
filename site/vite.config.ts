import { defineConfig, type Plugin } from "vite"
import react from "@vitejs/plugin-react"
import { agentFiles, jsonLd } from "./scripts/agent-files.ts"
import { MAP_DIR } from "./scripts/feature-audit.ts"

const TYPES: Record<string, string> = { ".txt": "text/plain; charset=utf-8", ".md": "text/markdown; charset=utf-8" }

// Match only account/device routes, keeping device codes and other query bytes.
function connectEntry(): Plugin {
  const rewrite = (preview: boolean) => (req: { url?: string }, _res: unknown, next: () => void) => {
    const url = req.url ?? ""
    const query = url.indexOf("?")
    const path = query < 0 ? url : url.slice(0, query)
    if (/^\/(?:connect|hosted)(?:\/device)?\/?$/.test(path)) {
      // Prerender removes the temporary input. Preview serves its route documents.
      req.url = (preview ? `${path.replace(/\/$/, "")}/index.html` : "/connect.html") + (query < 0 ? "" : url.slice(query))
    }
    next()
  }
  return {
    name: "apparent-connect-entry",
    configureServer(server) { server.middlewares.use(rewrite(false)) },
    configurePreviewServer(server) { server.middlewares.use(rewrite(true)) },
  }
}

// llms.txt, llms-full.txt and skill.md at the site root, plus the JSON-LD in index.html.
function forAgents(): Plugin {
  return {
    name: "apparent-agent-files",
    transformIndexHtml: () => [{ tag: "script", attrs: { type: "application/ld+json" }, children: jsonLd(), injectTo: "head" }],
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const name = req.url?.split("?")[0].slice(1) ?? ""
        const file = agentFiles()[name]
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

// The feature map in dev; scripts/prerender.ts writes it for builds.
function featureMap(): Plugin {
  return {
    name: "apparent-feature-map",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const path = req.url?.split("?")[0] ?? ""
        if (path !== `/${MAP_DIR}` && path !== `/${MAP_DIR}/`) return next()
        const { audit } = await server.ssrLoadModule("/scripts/feature-audit.ts")
        const { mapPage } = await server.ssrLoadModule("/src/map/page.tsx")
        res.setHeader("Content-Type", "text/html; charset=utf-8")
        res.end(mapPage(audit()))
      })
    },
  }
}

export default defineConfig({
  // The public Apparent demo has no Kit release feed, agent instructions or feature map.
  plugins: [react(), connectEntry(), ...(process.env.APPARENT_PUBLIC_SITE === "1" ? [] : [forAgents(), featureMap()])],
  // three.js lives in the lazily loaded hero brush chunk.
  build: { chunkSizeWarningLimit: 700, rolldownOptions: { input: { index: "index.html", connect: "connect.html" } } },
  // Previews are shared over Tailscale (studio.*.ts.net).
  server: { allowedHosts: [".ts.net"] },
  preview: { allowedHosts: [".ts.net"] },
})
