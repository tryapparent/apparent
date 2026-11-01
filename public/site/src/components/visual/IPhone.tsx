import type { ReactNode } from "react"

function Screen({ children }: { children?: ReactNode }) {
  return (
    <div className="ip-bezel">
      <div className="ip-screen">
        <div className="ip-status">
          <b>9:41</b>
          <span className="ip-island" />
          <span className="ip-batt" />
        </div>
        <div className="ip-nav">Deploys</div>
        <div className="ip-card">
          <div className="ip-head">
            <i className="ip-title" />
            <span className="ip-live">
              <i />
              Live
            </span>
          </div>
          {[0.72, 0.58, 0.66, 0.5].map((w, i) => (
            <div key={i} className="ip-row">
              <i style={{ width: `${w * 100}%` }} />
              <em className={i === 1 ? "fail" : ""} />
            </div>
          ))}
        </div>
        <div className="ip-rows">
          {[0.8, 0.62, 0.7].map((w, i) => (
            <i key={i} style={{ width: `${w * 100}%` }} />
          ))}
        </div>
        <div className="ip-bar">
          <span>Checkout</span>
        </div>
        {children}
      </div>
    </div>
  )
}

function MirrorVisual() {
  return (
    <div className="ip-visual" aria-hidden>
      <div className="ip-stack">
        <Screen>
          <svg className="ip-ink" viewBox="0 0 160 330" aria-hidden>
            <path d="M84 70c-18-12-62-10-66 6-4 17 46 22 76 18 26-3 40-14 28-24-11-9-39-10-58-6" />
            <path d="M144 236c8 30 2 52-20 66M124 302l11-2M124 302l3-11" />
          </svg>
          <span className="ip-pin" style={{ left: "77%", top: "16%" }}>
            1
          </span>
          <span className="ip-pin" style={{ left: "88%", top: "70%" }}>
            2
          </span>
        </Screen>
        <span className="ip-rec">
          <i />
          REC
        </span>
      </div>
    </div>
  )
}

export function IPhoneSection() {
  return (
    <section id="iphone" className="iphone-section">
      <h2>iPhone</h2>
      <div className="feature-cards">
        <article className="feature-card">
          <MirrorVisual />
          <div className="feature-copy">
            <h3>Plug it into your Mac</h3>
            <p>Your iPhone’s screen appears in a window on the Mac, and you talk and draw over it as it records.</p>
          </div>
        </article>
      </div>
    </section>
  )
}
