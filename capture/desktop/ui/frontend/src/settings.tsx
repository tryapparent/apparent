import { createRoot } from 'react-dom/client';
import { Agents } from './settings/agents/agents';
import { Labs, type NoteExperiment } from './settings/labs/labs';
import { Storage } from './storage';

class SettingsPane extends HTMLElement {
  static observedAttributes = ["pane"];
  private renderNoteExperiment?: NoteExperiment;
  set noteExperiment(component: NoteExperiment | undefined) {
    this.renderNoteExperiment = component;
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
      pane === "Labs" ? <Labs noteExperiment={this.renderNoteExperiment} /> : <Storage settings />);
  }
}

customElements.define("apparent-settings-pane", SettingsPane);
