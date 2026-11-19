import { HermesVideo } from "./HermesVideo"
import { PhotoStory } from "./PhotoStory"
import { FrogPond } from "./FrogPond"
import { GithubStars } from "./GithubStars"
import { Footer } from "../../footer/Footer"
import { FeatureGrid } from "../../features/FeatureGrid"

export function App() {
  return (
    <div className="pond-page">
      <header className="pond-nav">
        <a className="brand" href="#top" aria-label="apparent home">
          <img src="/apparent-wordmark.svg" width={149} height={35} decoding="async" alt="apparent" />
        </a>
        <GithubStars />
      </header>
      <main>
        <FrogPond />
        <HermesVideo />
        <FeatureGrid />
        <PhotoStory />
      </main>
      <Footer />
    </div>
  )
}
