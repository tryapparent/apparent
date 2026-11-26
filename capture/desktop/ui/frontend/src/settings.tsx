import { createRoot } from 'react-dom/client';
import { Agents } from './settings/agents/agents';
import { Labs } from './settings/labs/labs';
import { Storage } from './storage';

class SettingsPane extends HTMLElement {
  static observedAttributes = ["pane"];
  private labsExperiments: React.ComponentProps<typeof Labs> = {};
  set experiments(components: React.ComponentProps<typeof Labs> | undefined) {
    this.labsExperiments = components ?? {};
    this.renderPane();
  }

  private root?: ReturnType<typeof createRoot>;

  connectedCallback() {
    this.root = createRoot(this);
    this.renderPane();
  }

  disconnectedCallback() {
    const root = this.root;
    this.root = undefined;
    queueMicrotask(() => root?.unmount());
  }

  attributeChangedCallback() {
    this.renderPane();
  }

  private renderPane() {
    const pane = this.getAttribute("pane");
    this.root?.render(pane === "Agents" ? <Agents /> :
      pane === "Labs" ? <Labs {...this.labsExperiments} /> : <Storage settings />);
  }
}

customElements.define("apparent-settings-pane", SettingsPane);
