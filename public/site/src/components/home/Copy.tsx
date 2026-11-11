import { useState } from "react"

export function Copy({ text, label = "Copy" }: { text: string; label?: string }) {
  const [status, setStatus] = useState<"idle" | "copied" | "failed">("idle")
  return (
    <button
      type="button"
      className="copy"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text)
          setStatus("copied")
        } catch {
          setStatus("failed")
        }
        setTimeout(() => setStatus("idle"), 1400)
      }}
      aria-live="polite"
    >
      {status === "copied" ? "Copied" : status === "failed" ? "Copy failed" : label}
    </button>
  )
}
