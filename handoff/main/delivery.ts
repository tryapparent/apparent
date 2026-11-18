import { randomUUID } from "node:crypto";
import type { Destination } from "../../capture/desktop/ui/frontend/src/pill/destinations.ts";
export type Target = {
  origin: string;
  threadId: string;
  projectId: string;
  title: string;
  launch?: {
    modelSelection: unknown;
    runtimeMode: string;
    interactionMode: string;
    workspaceStrategy: object;
  };
};
export type Job = {
  version: 1;
  capture: string;
  createdAt: number;
  sentAt?: number;
  target: Target;
  commandId: string;
  messageId: string;
  text: string | null;
  phase: "armed" | "sending" | "sent" | "error" | "uncertain" | "cancelled";
};
export type JobStore = { save(job: Job): Promise<void> };
export type Sender = { rpc(tag: string, payload: object): Promise<unknown> };
export class Delivery {
  private busy = new Set<string>();
  readonly store: JobStore;
  readonly sender: (origin: string) => Sender;
  constructor(store: JobStore, sender: (origin: string) => Sender) {
    this.store = store;
    this.sender = sender;
  }
  create(capture: string, target: Target, text: string | null): Job {
    return {
      version: 1,
      capture,
      createdAt: Date.now(),
      target: structuredClone(target),
      commandId: randomUUID(),
      messageId: randomUUID(),
      text,
      phase: "armed",
    };
  }
  async submit(job: Job) {
    if (
      this.busy.has(job.capture) ||
      job.phase === "sent" ||
      job.phase === "cancelled" ||
      job.text === null
    )
      return;
    this.busy.add(job.capture);
    let dispatched = false;
    try {
      job.phase = "sending";
      await this.store.save(job);
      const t = job.target,
        sender = this.sender(t.origin);
      const payload = t.launch
        ? {
            commandId: job.commandId,
            threadId: t.threadId,
            projectId: t.projectId,
            title: "Recording",
            generateTitle: true,
            ...t.launch,
            creationSource: "web",
            initialMessage: {
              messageId: job.messageId,
              text: job.text,
              attachments: [],
            },
          }
        : {
            type: "message.dispatch",
            commandId: job.commandId,
            threadId: t.threadId,
            messageId: job.messageId,
            text: job.text,
            attachments: [],
            createdBy: "user",
            creationSource: "web",
            deliveryIntent: "auto",
            dispatchMode: { type: "start_immediately" },
          };
      dispatched = true;
      await sender.rpc(
        t.launch
          ? "orchestration.launchThread"
          : "orchestration.dispatchCommand",
        payload,
      );
      const sentAt = Date.now();
      await this.store.save({ ...job, phase: "sent", text: null, sentAt });
      job.sentAt = sentAt;
      job.phase = "sent";
      job.text = null;
    } catch {
      job.phase = dispatched ? "uncertain" : "error";
      await this.store.save(job);
    } finally {
      this.busy.delete(job.capture);
    }
  }
  async cancel(job: Job) {
    if (job.phase !== "armed") throw Error("Handoff has already started");
    job.phase = "cancelled";
    await this.store.save(job);
  }
}
export function choiceTarget(
  choice: Destination,
  threads: Record<string, unknown>[],
  project: Record<string, unknown>,
  origin: string,
  defaults?: {
    modelSelection: unknown;
    runtimeMode: string;
    workspaceStrategy: object;
  },
): Target {
  if (choice.id !== "new") {
    const t = threads.find((t) => t.id === choice.id);
    if (!t || typeof t.projectId !== "string")
      throw Error("Destination no longer available");
    return {
      origin,
      threadId: choice.id,
      projectId: t.projectId,
      title: choice.title,
    };
  }
  const model = project.defaultModelSelection ?? defaults?.modelSelection;
  if (!model || typeof project.id !== "string")
    throw Error("Choose a default model in the T3 project first");
  if (!defaults) throw Error("T3 project defaults unavailable");
  return {
    origin,
    threadId: randomUUID(),
    projectId: project.id,
    title: "New thread",
    launch: {
      modelSelection: model,
      runtimeMode: defaults.runtimeMode,
      interactionMode: "default",
      workspaceStrategy: defaults.workspaceStrategy,
    },
  };
}
