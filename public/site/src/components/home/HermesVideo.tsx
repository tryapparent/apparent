import { useCallback, useState, useSyncExternalStore } from "react"
import "./hermes-video.css"

const EMBED = "https://www.youtube-nocookie.com/embed/IXJVr0-PJ7k?mute=1&playsinline=1&rel=0"
const WATCH = "https://youtu.be/IXJVr0-PJ7k"
const MARKETPLACE = "https://hermes-agent.nousresearch.com/marketplace/apparent"
const motionPreference = () => matchMedia("(prefers-reduced-motion: reduce)")

function subscribe(onChange: () => void) {
  const preference = motionPreference()
  preference.addEventListener("change", onChange)
  return () => preference.removeEventListener("change", onChange)
}

export function HermesVideo() {
  const [visible, setVisible] = useState(false)
  const source = useSyncExternalStore(subscribe,
    () => motionPreference().matches ? EMBED : `${EMBED}&autoplay=1`,
    () => undefined)

  const observeVisibility = useCallback((frame: HTMLIFrameElement | null) => {
    if (!frame) return
    const threshold = 0.75
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.intersectionRatio < threshold) return
      observer.disconnect()
      setVisible(true)
    }, { threshold })
    observer.observe(frame)
    return () => observer.disconnect()
  }, [])

  return (
    <section className="pond-demo hermes-video" aria-labelledby="hermes-video-title">
      <h2 id="hermes-video-title"><img src="/apparent-wordmark.svg" alt="apparent" width={120} height={28} /> is now a <a href={MARKETPLACE}>Hermes Agent plugin</a></h2>
      <div className="demo-section" id="demo">
        <iframe ref={observeVisibility} src={visible ? source : undefined} title="Apparent’s Hermes Agent hackathon submission" loading="lazy"
          referrerPolicy="strict-origin-when-cross-origin" allow="autoplay; encrypted-media; picture-in-picture" allowFullScreen />
        <a href={WATCH}>Open on YouTube</a>
      </div>
    </section>
  )
}
