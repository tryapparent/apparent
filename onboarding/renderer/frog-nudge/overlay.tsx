import { createRoot } from "react-dom/client";

createRoot(document.getElementById("root")!).render(
  <img
    src="./wave.webp"
    alt=""
    onLoad={() => setTimeout(() => window.close(), 8_000)}
    onError={() => window.close()}
  />,
);
