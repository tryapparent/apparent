import { createRoot } from 'react-dom/client';
import { Agents } from './settings/agents/agents';
import { Labs, type LabsExperiment } from './settings/labs/labs';
import { Storage } from './storage';

class SettingsPane extends HTMLElement {
  static observedAttributes = ["pane"];
  private renderFrogExperiment?: LabsExperiment;
  private renderAgentContextExperiment?: LabsExperiment;

  set frogExperiment(component: LabsExperiment | undefined) {
    this.renderFrogExperiment = component;
    this.renderPane();
  }

  set agentContextExperiment(component: LabsExperiment | undefined) {
    this.renderAgentContextExperiment = component;
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
      pane === "Labs" ? <Labs frogExperiment={this.renderFrogExperiment} agentContextExperiment={this.renderAgentContextExperiment} /> : <Storage settings />);
  }
}

customElements.define("apparent-settings-pane", SettingsPane);
