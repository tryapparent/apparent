import { Copy } from "./Copy"
import "./setup-prompt.css"

const prompt = "Install and launch Apparent using https://github.com/tryapparent/apparent. If you’re Hermes, install and enable both the Agent and Desktop plugin halves, help the user to rescan/reload Desktop plugins."

export function SetupPrompt() {
  return <div className="setup-prompt">
    <div className="setup-prompt-field">
      <input id="setup-prompt" aria-label="Apparent setup prompt" readOnly defaultValue="Install apparent…" onFocus={event => { event.currentTarget.value = prompt; event.currentTarget.select() }} onBlur={event => { event.currentTarget.value = "Install apparent…" }} />
      <Copy text={prompt} label="Copy Prompt" />
    </div>
  </div>
}
