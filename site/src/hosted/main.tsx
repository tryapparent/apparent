import { StrictMode } from "react"
import { createRoot, hydrateRoot } from "react-dom/client"
import { Hosted } from "./Hosted"
import "./base.css"

const root = document.getElementById("root")!
const app = (
  <StrictMode>
    <Hosted devicePage={/^\/(?:connect|hosted)\/device\/?$/.test(window.location.pathname)} />
  </StrictMode>
)

// scripts/prerender.ts fills #root at build time; the dev server serves it empty.
if (root.firstElementChild) hydrateRoot(root, app)
else createRoot(root).render(app)
