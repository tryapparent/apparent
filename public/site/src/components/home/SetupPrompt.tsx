import { Copy } from "./Copy"
import "./setup-prompt.css"

const prompt = "Install Apparent for this Mac or Linux computer using https://github.com/tryapparent/apparent, asking before system changes. Launch it, verify it opens, and start onboarding. If you’re Hermes, also install Apparent’s Hermes plugin using the repo instructions."

export function SetupPrompt() {
  return <div className="setup-prompt">
    <div className="setup-prompt-field">
      <input id="setup-prompt" aria-label="Apparent setup prompt" readOnly defaultValue="Install apparent…" onFocus={event => { event.currentTarget.value = prompt; event.currentTarget.select() }} onBlur={event => { event.currentTarget.value = "Install apparent…" }} />
      <Copy text={prompt} label="Copy Prompt" />
    </div>
  </div>
}
