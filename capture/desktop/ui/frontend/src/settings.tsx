import { createRoot } from 'react-dom/client';
import { Agents } from './settings/agents/agents';
import { Labs, type LabsExperiment, type AutoPasteExperiment, type PushToTalkExperiment } from './settings/labs/labs';
import { Storage } from './storage';

class SettingsPane extends HTMLElement {
  static observedAttributes = ["pane"];
  private renderSpeakingStyleExperiment?: LabsExperiment;
  set speakingStyleExperiment(component: LabsExperiment | undefined) {
    this.renderSpeakingStyleExperiment = component;
    this.renderPane();
  }
  private renderFrogExperiment?: LabsExperiment;
  private renderAgentContextExperiment?: LabsExperiment;
  private renderCircleLabelsExperiment?: LabsExperiment;

  set circleLabelsExperiment(component: LabsExperiment | undefined) {
    this.renderCircleLabelsExperiment = component;
    this.renderPane();
  }

  set frogExperiment(component: LabsExperiment | undefined) {
    this.renderFrogExperiment = component;
    this.renderPane();
  }

  private renderAutoPasteExperiment?: AutoPasteExperiment;

  set autoPasteExperiment(component: AutoPasteExperiment | undefined) {
    this.renderAutoPasteExperiment = component;
    this.renderPane();
  }

  set agentContextExperiment(component: LabsExperiment | undefined) {
    this.renderAgentContextExperiment = component;
    this.renderPane();
  }

  private renderPushToTalkExperiment?: PushToTalkExperiment;
  private renderPillDoodlesExperiment?: LabsExperiment<boolean | null | undefined>;

  set pillDoodlesExperiment(component: LabsExperiment<boolean | null | undefined> | undefined) {
    this.renderPillDoodlesExperiment = component;
    this.renderPane();
  }

  set pushToTalkExperiment(component: PushToTalkExperiment | undefined) {
    this.renderPushToTalkExperiment = component;
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
      pane === "Labs" ? <Labs speakingStyleExperiment={this.renderSpeakingStyleExperiment} circleLabelsExperiment={this.renderCircleLabelsExperiment} frogExperiment={this.renderFrogExperiment} agentContextExperiment={this.renderAgentContextExperiment} autoPasteExperiment={this.renderAutoPasteExperiment} pushToTalkExperiment={this.renderPushToTalkExperiment} pillDoodlesExperiment={this.renderPillDoodlesExperiment} /> : <Storage settings />);
  }
}

customElements.define("apparent-settings-pane", SettingsPane);
