import { useSyncExternalStore } from "react"
import "./hermes-video.css"

const EMBED = "https://www.youtube-nocookie.com/embed/IXJVr0-PJ7k?mute=1&playsinline=1&rel=0"
const WATCH = "https://youtu.be/IXJVr0-PJ7k"
const motionPreference = () => matchMedia("(prefers-reduced-motion: reduce)")

function subscribe(onChange: () => void) {
  const preference = motionPreference()
  preference.addEventListener("change", onChange)
  return () => preference.removeEventListener("change", onChange)
}

export function HermesVideo() {
  const source = useSyncExternalStore(subscribe,
    () => motionPreference().matches ? EMBED : `${EMBED}&autoplay=1`,
    () => undefined)

  return (
    <section className="pond-demo hermes-video" aria-labelledby="hermes-video-title">
      <h2 id="hermes-video-title"><img src="/apparent-wordmark.svg" alt="apparent" width={120} height={28} /> is now a Hermes Agent plugin</h2>
      <div className="demo-section" id="demo">
        <iframe src={source} title="Apparent’s Hermes Agent hackathon submission" loading="lazy"
          referrerPolicy="strict-origin-when-cross-origin" allow="autoplay; encrypted-media; picture-in-picture" allowFullScreen />
        <a href={WATCH}>Open on YouTube</a>
      </div>
    </section>
  )
}
